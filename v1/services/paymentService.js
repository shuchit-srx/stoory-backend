const { supabaseAdmin } = require("../db/config");
const Razorpay = require("razorpay");
const crypto = require("crypto");

// Initialize Razorpay
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn(
    "⚠️  RazorPay environment variables not set. Payment features will be limited."
  );
}

/**
 * Payment Service for Applications
 * Handles payment flow: Brand pays admin after application completion, Admin releases to influencer
 */
class PaymentService {
  /**
   * Normalize payment status to UPPERCASE
   * Valid statuses: CREATED, PROCESSING, VERIFIED, FAILED, REFUNDED
   */
  normalizeStatus(status) {
    if (!status) return null;
    const normalized = String(status).toUpperCase().trim();
    const validStatuses = ["CREATED", "PROCESSING", "VERIFIED", "FAILED", "REFUNDED"];
    if (validStatuses.includes(normalized)) {
      return normalized;
    }
    return status; // Return original if not valid (for error handling)
  }

  /**
   * Convert rupees to paise (only for Razorpay API)
   * @param {number} rupees - Amount in rupees
   * @returns {number} Amount in paise
   */
  rupeesToPaise(rupees) {
    return Math.round(parseFloat(rupees) * 100);
  }

  /**
   * Convert paise to rupees (only from Razorpay API responses)
   * @param {number} paise - Amount in paise
   * @returns {number} Amount in rupees
   */
  paiseToRupees(paise) {
    return parseFloat((paise / 100).toFixed(2));
  }

  /**
   * Convert Razorpay order object amounts from paise to rupees
   */
  convertRazorpayOrderToRupees(razorpayOrder) {
    if (!razorpayOrder) return null;
    
    return {
      ...razorpayOrder,
      amount: razorpayOrder.amount ? this.paiseToRupees(razorpayOrder.amount) : 0,
      amount_paid: razorpayOrder.amount_paid ? this.paiseToRupees(razorpayOrder.amount_paid) : 0,
      amount_due: razorpayOrder.amount_due ? this.paiseToRupees(razorpayOrder.amount_due) : 0,
    };
  }

  /**
   * Calculate commission and breakdown (all amounts in rupees)
   * @param {number} amount - Total amount to calculate commission for
   * @param {number} platformFeePercentage - Optional platform fee percentage from campaign/application
   */
  async calculateCommissionBreakdown(amount, platformFeePercentage = null) {
    try {
      let commissionPercentage;
      
      if (platformFeePercentage !== null && platformFeePercentage !== undefined) {
        // Use platform_fee_percentage from campaign/application
        commissionPercentage = parseFloat(platformFeePercentage);
      } else {
        // Fallback: Get current admin settings (non-expired) - for backward compatibility
        const { data: adminSettings, error: commError } = await supabaseAdmin
          .from("v1_admin_settings")
          .select("*")
          .eq("is_expired", false)
          .maybeSingle();

        if (commError || !adminSettings) {
          console.warn("⚠️ No admin settings found, using default 10%");
          commissionPercentage = 10.0;
        } else {
          commissionPercentage = adminSettings.commission_percentage;
        }
      }

      // All calculations in rupees
      const totalAmount = parseFloat(amount);
      const commissionAmount = (totalAmount * commissionPercentage) / 100;
      const netAmount = totalAmount - commissionAmount;

      return {
        total_amount: totalAmount,
        commission_amount: commissionAmount,
        net_amount: netAmount,
        commission_percentage: commissionPercentage,
      };
    } catch (err) {
      console.error("[v1/PaymentService/calculateCommissionBreakdown] Exception:", err);
      throw err;
    }
  }

  /**
   * Create Razorpay order for application payment (Brand pays admin)
   * Only allowed when application phase is ACCEPTED
   */
  async createPaymentOrder(applicationId, userId) {
    try {
      if (!razorpay) {
        return {
          success: false,
          message: "Payment service is not configured",
        };
      }

      // Get application with campaign details including budget and platform_fee_percentage
      const { data: application, error: applicationError } = await supabaseAdmin
        .from("v1_applications")
        .select(`
          *,
          v1_campaigns!inner(
            id,
            brand_id,
            title,
            budget,
            platform_fee_percentage
          )
        `)
        .eq("id", applicationId)
        .single();

      if (applicationError || !application) {
        return {
          success: false,
          message: "Application not found",
        };
      }

      // Check if application phase is ACCEPTED (payment can be made after acceptance)
      if (application.phase !== "ACCEPTED") {
        return {
          success: false,
          message: "Payment can only be initiated for accepted applications",
        };
      }

      // Check if user is the brand owner
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Permission check: Only brand owner can pay for their applications
      if (user.role !== "ADMIN" && application.v1_campaigns.brand_id !== userId) {
        return {
          success: false,
          message: "You don't have permission to pay for this application",
        };
      }

      // Validate that campaign budget equals application budget_amount
      const campaignBudget = application.v1_campaigns.budget;
      const applicationBudgetAmount = application.budget_amount;
      
      if (campaignBudget === null || campaignBudget === undefined) {
        return {
          success: false,
          message: "Campaign does not have a valid budget",
        };
      }

      if (applicationBudgetAmount === null || applicationBudgetAmount === undefined) {
        return {
          success: false,
          message: "Application does not have a valid budget amount",
        };
      }

      // Validate budget matches (allow small floating point differences)
      if (Math.abs(campaignBudget - applicationBudgetAmount) > 0.01) {
        return {
          success: false,
          message: `Campaign budget (₹${campaignBudget}) does not match application budget amount (₹${applicationBudgetAmount}). Please contact support.`,
        };
      }

      // Determine payment amount: use budget from campaign or budget_amount from application
      // Both should be equal after validation above, but prefer campaign budget as source of truth
      const paymentAmount = campaignBudget || applicationBudgetAmount;

      if (!paymentAmount || paymentAmount <= 0) {
        return {
          success: false,
          message: "Invalid payment amount. Budget must be greater than 0",
        };
      }

      // Get platform_fee_percentage from application (which came from campaign)
      const platformFeePercentage = application.platform_fee_percentage ?? application.v1_campaigns.platform_fee_percentage;

      if (platformFeePercentage === null || platformFeePercentage === undefined) {
        return {
          success: false,
          message: "Application does not have a valid platform fee percentage",
        };
      }

      // Check if payment already exists for this application
      const { data: existingPayment } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("id, status")
        .eq("payable_type", "APPLICATION")
        .eq("payable_id", applicationId)
        .maybeSingle();

      if (existingPayment) {
        // Normalize status to UPPERCASE
        const normalizedStatus = this.normalizeStatus(existingPayment.status) || existingPayment.status;
        if (normalizedStatus === "VERIFIED") {
          return {
            success: false,
            message: "Payment already completed for this application",
          };
        }
        // If payment exists but not verified, can create new one or return existing
        return {
          success: false,
          message: "Payment order already exists for this application",
        };
      }

      // Calculate commission breakdown using payment amount (budget) and platform_fee_percentage from application
      const breakdown = await this.calculateCommissionBreakdown(paymentAmount, platformFeePercentage);

      // Razorpay receipt must be <= 40 chars
      const rawReceipt = `app_${applicationId.substring(0, 20)}_${Date.now()}`;
      const safeReceipt = rawReceipt.substring(0, 40);

      // Convert to paise for Razorpay API (Razorpay requires amounts in paise)
      const amountInPaise = Math.round(breakdown.total_amount * 100);

      // Create Razorpay order
      const orderOptions = {
        amount: amountInPaise,
        currency: "INR",
        receipt: safeReceipt,
        notes: {
          application_id: applicationId,
          campaign_id: application.campaign_id,
          brand_id: application.v1_campaigns.brand_id,
          influencer_id: application.influencer_id,
          payer_id: userId,
          payment_type: "application_payment",
          commission_percentage: breakdown.commission_percentage,
        },
      };

      const razorpayOrder = await razorpay.orders.create(orderOptions);

      // Store payment order in database (amount in rupees)
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("v1_payment_orders")
        .insert({
          payable_type: "APPLICATION",
          payable_id: applicationId,
          amount: breakdown.total_amount,
          currency: "INR",
          status: "CREATED",
          razorpay_order_id: razorpayOrder.id,
          metadata: {
            campaign_id: application.campaign_id,
            brand_id: application.v1_campaigns.brand_id,
            influencer_id: application.influencer_id,
            payer_id: userId,
            payer_role: user.role,
            payment_type: "application_payment",
            budget_amount: paymentAmount, // Store the budget amount paid
            agreed_amount: application.agreed_amount, // Keep for reference
            commission_percentage: breakdown.commission_percentage,
            commission_amount: breakdown.commission_amount,
            net_amount: breakdown.net_amount,
            campaign_title: application.v1_campaigns.title,
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error(
          "[v1/PaymentService/createPaymentOrder] Database error:",
          orderError
        );
        return {
          success: false,
          message: "Failed to create payment order",
          error: orderError.message,
        };
      }

      // Convert Razorpay order amounts from paise to rupees for response
      const orderInRupees = this.convertRazorpayOrderToRupees(razorpayOrder);

      return {
        success: true,
        order: orderInRupees,
        payment_order: paymentOrder,
        breakdown: breakdown,
        message: "Payment order created successfully",
      };
    } catch (err) {
      console.error("[v1/PaymentService/createPaymentOrder] Exception:", err);
      return {
        success: false,
        message: "Failed to create payment order",
        error: err.message,
      };
    }
  }

  /**
   * Create bulk payment order for campaign (Brand pays admin for all accepted applications)
   * Aggregates budget_amount of all ACCEPTED applications for the campaign
   * Only allowed when campaign has accepted applications
   */
  async createBulkPaymentOrderForCampaign(campaignId, userId) {
    try {
      if (!razorpay) {
        return {
          success: false,
          message: "Payment service is not configured",
        };
      }

      // Get campaign with platform_fee_percentage
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, brand_id, title, platform_fee_percentage")
        .eq("id", campaignId)
        .single();

      if (campaignError || !campaign) {
        return {
          success: false,
          message: "Campaign not found",
        };
      }

      // Check if user is the brand owner or admin
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Permission check: Only brand owner can pay for their campaigns
      if (user.role !== "ADMIN" && campaign.brand_id !== userId) {
        return {
          success: false,
          message: "You don't have permission to pay for this campaign",
        };
      }

      // Get all ACCEPTED applications for this campaign
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, budget_amount, agreed_amount, phase")
        .eq("campaign_id", campaignId)
        .eq("phase", "ACCEPTED");

      if (applicationsError) {
        return {
          success: false,
          message: "Failed to load applications",
          error: applicationsError.message,
        };
      }

      if (!applications || applications.length === 0) {
        return {
          success: false,
          message: "No accepted applications found for this campaign",
        };
      }

      const applicationIds = applications.map(a => a.id);

      // Check which applications already have verified payments
      const { data: existingPayments, error: existingPaymentsError } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("payable_type, payable_id, status")
        .eq("payable_type", "APPLICATION")
        .in("payable_id", applicationIds);

      if (existingPaymentsError) {
        console.error("[v1/PaymentService/createBulkPaymentOrderForCampaign] Error checking existing payments:", existingPaymentsError);
      }

      // Filter out applications that already have verified payments
      const paidAppIds = new Set(
        (existingPayments || [])
          .filter(p => {
            const normalizedStatus = this.normalizeStatus(p.status) || p.status;
            return normalizedStatus === "VERIFIED";
          })
          .map(p => p.payable_id)
      );

      const payableApplications = applications.filter(a => !paidAppIds.has(a.id));

      if (payableApplications.length === 0) {
        return {
          success: false,
          message: "All accepted applications are already paid",
        };
      }

      // Aggregate budget_amount of all payable applications
      const totalAmount = payableApplications.reduce((sum, app) => {
        const amount = Number(app.budget_amount ?? app.agreed_amount ?? 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);

      if (!totalAmount || totalAmount <= 0) {
        return {
          success: false,
          message: "Invalid total amount for bulk payment",
        };
      }

      // Get platform_fee_percentage from campaign
      const platformFeePercentage = campaign.platform_fee_percentage;

      if (platformFeePercentage === null || platformFeePercentage === undefined) {
        return {
          success: false,
          message: "Campaign does not have a valid platform fee percentage",
        };
      }

      // Check if bulk payment order already exists for this campaign
      const { data: existingBulkPayment } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("id, status")
        .eq("payable_type", "CAMPAIGN")
        .eq("payable_id", campaignId)
        .maybeSingle();

      if (existingBulkPayment) {
        const normalizedStatus = this.normalizeStatus(existingBulkPayment.status) || existingBulkPayment.status;
        if (normalizedStatus === "VERIFIED") {
          return {
            success: false,
            message: "Bulk payment already completed for this campaign",
          };
        }
        return {
          success: false,
          message: "Bulk payment order already exists for this campaign",
        };
      }

      // Calculate commission breakdown using total amount and platform_fee_percentage
      const breakdown = await this.calculateCommissionBreakdown(totalAmount, platformFeePercentage);

      // Razorpay receipt must be <= 40 chars
      const rawReceipt = `camp_${campaignId.substring(0, 20)}_${Date.now()}`;
      const safeReceipt = rawReceipt.substring(0, 40);

      // Convert to paise for Razorpay API (Razorpay requires amounts in paise)
      const amountInPaise = Math.round(breakdown.total_amount * 100);

      // Create Razorpay order
      const orderOptions = {
        amount: amountInPaise,
        currency: "INR",
        receipt: safeReceipt,
        notes: {
          campaign_id: campaignId,
          brand_id: campaign.brand_id,
          payer_id: userId,
          payment_type: "campaign_bulk_payment",
          application_ids: payableApplications.map(a => a.id),
          commission_percentage: breakdown.commission_percentage,
        },
      };

      const razorpayOrder = await razorpay.orders.create(orderOptions);

      // Store payment order in database (amount in rupees)
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("v1_payment_orders")
        .insert({
          payable_type: "CAMPAIGN",
          payable_id: campaignId,
          amount: breakdown.total_amount,
          currency: "INR",
          status: "CREATED",
          razorpay_order_id: razorpayOrder.id,
          metadata: {
            campaign_id: campaignId,
            brand_id: campaign.brand_id,
            payer_id: userId,
            payer_role: user.role,
            payment_type: "campaign_bulk_payment",
            application_ids: payableApplications.map(a => a.id),
            application_count: payableApplications.length,
            total_budget_amount: totalAmount,
            commission_percentage: breakdown.commission_percentage,
            commission_amount: breakdown.commission_amount,
            net_amount: breakdown.net_amount,
            campaign_title: campaign.title,
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error(
          "[v1/PaymentService/createBulkPaymentOrderForCampaign] Database error:",
          orderError
        );
        return {
          success: false,
          message: "Failed to create payment order",
          error: orderError.message,
        };
      }

      // Convert Razorpay order amounts from paise to rupees for response
      const orderInRupees = this.convertRazorpayOrderToRupees(razorpayOrder);

      return {
        success: true,
        order: orderInRupees,
        payment_order: paymentOrder,
        breakdown: breakdown,
        application_count: payableApplications.length,
        application_ids: payableApplications.map(a => a.id),
        message: "Bulk payment order created successfully",
      };
    } catch (err) {
      console.error("[v1/PaymentService/createBulkPaymentOrderForCampaign] Exception:", err);
      return {
        success: false,
        message: "Failed to create bulk payment order",
        error: err.message,
      };
    }
  }

  /**
   * Verify payment and update payment order
   */
  async verifyPayment(paymentData) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        application_id,
      } = paymentData;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return {
          success: false,
          message: "Missing required payment information",
        };
      }

      // Verify payment signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      if (razorpay_signature !== expectedSignature) {
        return {
          success: false,
          message: "Invalid payment signature",
        };
      }

      // Get payment order
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("*")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (orderError || !paymentOrder) {
        return {
          success: false,
          message: "Payment order not found",
        };
      }

      // Normalize status to UPPERCASE (in case of legacy lowercase values)
      paymentOrder.status = this.normalizeStatus(paymentOrder.status) || paymentOrder.status;

      // Check if payment already verified
      if (paymentOrder.status === "VERIFIED") {
        return {
          success: false,
          message: "Payment already verified",
        };
      }

      // Check for duplicate payment
      const { data: existingPayment } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("id")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .single();

      if (existingPayment) {
        return {
          success: false,
          message: "Payment already processed",
        };
      }

      // Get application_id from payment order metadata or payable_id
      const orderApplicationId = paymentOrder.payable_type === "APPLICATION" 
        ? paymentOrder.payable_id 
        : paymentOrder.metadata?.application_id;

      // If application_id is provided in request, validate it matches the payment order
      if (application_id && application_id !== orderApplicationId) {
        return {
          success: false,
          message: "Application ID mismatch with payment order",
        };
      }

      // Verify application exists and is ACCEPTED, then transition phase after payment
      let application = null;
      if (orderApplicationId) {
        const { data: appData, error: applicationError } = await supabaseAdmin
          .from("v1_applications")
          .select(`
            id, 
            phase, 
            campaign_id,
            v1_campaigns!inner(
              id,
              brand_id
            )
          `)
          .eq("id", orderApplicationId)
          .single();

        if (applicationError || !appData) {
          return {
            success: false,
            message: "Application not found",
          };
        }

        application = appData;

        if (application.phase !== "ACCEPTED") {
          return {
            success: false,
            message: "Application must be accepted before payment",
          };
        }

        // Fetch campaign to check requires_script
        const { data: campaign, error: campaignError } = await supabaseAdmin
          .from("v1_campaigns")
          .select("requires_script")
          .eq("id", application.campaign_id)
          .maybeSingle();

        if (campaignError) {
          console.error("[v1/PaymentService/verifyPayment] Campaign fetch error:", campaignError);
        }

        // Determine next phase based on requires_script
        const nextPhase = campaign?.requires_script === true ? 'SCRIPT' : 'WORK';

        // Update application phase after payment verification
        const { error: phaseUpdateError } = await supabaseAdmin
          .from("v1_applications")
          .update({
            phase: nextPhase
          })
          .eq("id", orderApplicationId);

        if (phaseUpdateError) {
          console.error("[v1/PaymentService/verifyPayment] Phase update error:", phaseUpdateError);
          // Don't fail payment verification if phase update fails, but log it
        }
      }

      // Update payment order
      const { data: updatedOrder, error: updateError } = await supabaseAdmin
        .from("v1_payment_orders")
        .update({
          status: "VERIFIED",
          razorpay_payment_id: razorpay_payment_id,
          razorpay_signature: razorpay_signature,
        })
        .eq("id", paymentOrder.id)
        .select()
        .single();

      if (updateError) {
        console.error(
          "[v1/PaymentService/verifyPayment] Update error:",
          updateError
        );
        return {
          success: false,
          message: "Failed to verify payment",
          error: updateError.message,
        };
      }

      // Insert transaction record into v1_transactions after payment verification
      if (application && application.v1_campaigns) {
        try {
          const brandOwnerId = application.v1_campaigns.brand_id;
          
          // Get admin user ID (first admin user found, or use system admin)
          const { data: adminUser } = await supabaseAdmin
            .from("v1_users")
            .select("id")
            .eq("role", "ADMIN")
            .eq("is_deleted", false)
            .limit(1)
            .maybeSingle();

          // If no admin user found, use system admin ID
          const adminUserId = adminUser?.id || process.env.SYSTEM_ADMIN_USER_ID || "00000000-0000-0000-0000-000000000000";

          // Calculate amounts from payment order metadata
          const grossAmount = paymentOrder.amount || paymentOrder.metadata?.budget_amount || 0;
          const platformFee = paymentOrder.metadata?.commission_amount || 0;
          const netAmount = paymentOrder.metadata?.net_amount || (grossAmount - platformFee);

          // Insert transaction record
          const { error: transactionError } = await supabaseAdmin
            .from("v1_transactions")
            .insert({
              application_id: orderApplicationId,
              type: "BRAND_PAYMENT",
              from_entity: brandOwnerId,
              to_entity: adminUserId,
              gross_amount: grossAmount,
              platform_fee: platformFee,
              net_amount: netAmount,
              status: "COMPLETED",
            });

          if (transactionError) {
            console.error(
              "[v1/PaymentService/verifyPayment] Transaction insert error:",
              transactionError
            );
            // Don't fail payment verification if transaction record fails, but log it
          }
        } catch (txnErr) {
          console.error(
            "[v1/PaymentService/verifyPayment] Transaction creation exception:",
            txnErr
          );
          // Don't fail payment verification if transaction record fails
        }
      }

      // Chat creation is now handled via endpoint only: POST /api/v1/chat/:applicationId
      // Chat should be created explicitly by calling the endpoint after payment verification

      return {
        success: true,
        payment_order: updatedOrder,
        message: "Payment verified successfully",
      };
    } catch (err) {
      console.error("[v1/PaymentService/verifyPayment] Exception:", err);
      return {
        success: false,
        message: "Failed to verify payment",
        error: err.message,
      };
    }
  }

  /**
   * Get payment config for frontend
   */
  getPaymentConfig() {
    if (!razorpay) {
      return {
        success: false,
        message: "Payment service is not configured",
      };
    }

    return {
      success: true,
      config: {
        key_id: process.env.RAZORPAY_KEY_ID,
        currency: "INR",
      },
    };
  }

  /**
   * Get payments for an application
   */
  async getApplicationPayments(applicationId) {
    try {
      // Get payment orders for this application
      const { data: payments, error } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("*")
        .eq("payable_type", "APPLICATION")
        .eq("payable_id", applicationId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(
          "[v1/PaymentService/getApplicationPayments] Database error:",
          error
        );
        return {
          success: false,
          message: "Failed to fetch payments",
          error: error.message,
        };
      }

      // Normalize all status values to UPPERCASE
      const normalizedPayments = (payments || []).map((payment) => ({
        ...payment,
        status: this.normalizeStatus(payment.status) || payment.status,
      }));

      return {
        success: true,
        payments: normalizedPayments,
        message: "Payments fetched successfully",
      };
    } catch (err) {
      console.error("[v1/PaymentService/getApplicationPayments] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch payments",
        error: err.message,
      };
    }
  }

  /**
   * Create payment order for subscription
   * Brand owner pays admin for subscription
   * @param {string} userId - User ID
   * @param {string} planId - Plan ID
   * @param {string} couponCode - Optional coupon code
   * @returns {Promise<Object>} Result with Razorpay order and payment order
   */
  async createSubscriptionPaymentOrder(userId, planId, couponCode = null) {
    try {
      if (!razorpay) {
        return {
          success: false,
          message: "Payment service is not configured",
        };
      }

      // Validate inputs
      if (!userId || !planId) {
        return {
          success: false,
          message: "userId and planId are required",
        };
      }

      // Check if user exists
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Only BRAND_OWNER can subscribe
      if (user.role !== "BRAND_OWNER") {
        return {
          success: false,
          message: "Only brand owners can create subscriptions",
        };
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("v1_plans")
        .select("*")
        .eq("id", planId)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        return {
          success: false,
          message: "Plan not found or not active",
        };
      }

      // All calculations in RUPEES
      let finalAmountRupees = plan.price;
      let discountAmountRupees = 0;
      let couponData = null;

      // Validate and apply coupon if provided (all in rupees)
      if (couponCode) {
        const CouponService = require("./couponService");
        const couponValidation = await CouponService.validateCoupon(
          couponCode,
          userId,
          plan.price // Pass in rupees
        );

        if (!couponValidation.success || !couponValidation.valid) {
          return {
            success: false,
            message: couponValidation.message || "Invalid coupon code",
          };
        }

        discountAmountRupees = couponValidation.discount_amount;
        finalAmountRupees = couponValidation.final_amount;
        couponData = {
          coupon_id: couponValidation.coupon.id,
          coupon_code: couponValidation.coupon.code,
          discount_amount: discountAmountRupees,
          original_amount: plan.price,
          final_amount: finalAmountRupees,
        };
      }

      // Check if user already has an active subscription
      const { data: existingSubscriptions, error: existingError } =
        await supabaseAdmin
          .from("v1_subscriptions")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "ACTIVE");

      if (existingError) {
        console.error(
          "[v1/PaymentService/createSubscriptionPaymentOrder] Error checking existing subscription:",
          existingError
        );
        return {
          success: false,
          message: "Failed to check existing subscriptions",
          error: existingError.message,
        };
      }

      if (existingSubscriptions && existingSubscriptions.length > 0) {
        return {
          success: false,
          message: "User already has an active subscription",
        };
      }

      // Check for existing pending payment order for this subscription
      // Query payment orders with subscription payment type
      const { data: existingPayments, error: existingPaymentError } =
        await supabaseAdmin
          .from("v1_payment_orders")
          .select("id, status, metadata")
          .eq("payable_type", "SUBSCRIPTION")
          .eq("payable_id", planId);

      let existingPayment = null;
      if (existingPayments && !existingPaymentError) {
        existingPayment = existingPayments.find(
          (p) =>
            p.metadata?.payment_type === "subscription_payment" &&
            p.metadata?.user_id === userId
        );
      }

      if (existingPayment) {
        const normalizedStatus =
          this.normalizeStatus(existingPayment.status) ||
          existingPayment.status;
        if (normalizedStatus === "VERIFIED") {
          return {
            success: false,
            message: "Payment already completed for this subscription",
          };
        }
        return {
          success: false,
          message: "Payment order already exists for this subscription",
        };
      }

      // Handle free subscriptions (amount = 0 rupees)
      if (finalAmountRupees === 0) {
        const SubscriptionService = require("./subscriptionService");
        const subscriptionResult = await SubscriptionService.createSubscription(
          userId,
          planId,
          false
        );

        if (!subscriptionResult.success) {
          return {
            success: false,
            message: "Failed to create free subscription",
            error: subscriptionResult.message,
          };
        }

        // Record coupon usage if coupon was applied
        if (couponData) {
          const CouponService = require("./couponService");
          await CouponService.applyCoupon(
            couponData.coupon_id,
            userId,
            subscriptionResult.subscription.id,
            couponData.original_amount, // All in rupees
            couponData.discount_amount, // All in rupees
            couponData.final_amount // All in rupees
          );
        }

        return {
          success: true,
          order: null,
          payment_order: null,
          plan: plan,
          subscription: subscriptionResult.subscription,
          coupon: couponData,
          message: "Free subscription created successfully",
        };
      }

      // ONLY HERE: Convert to paise for Razorpay API (Razorpay requirement)
      const amountInPaise = this.rupeesToPaise(finalAmountRupees);

      if (amountInPaise <= 0) {
        return {
          success: false,
          message: "Invalid final amount after discount",
        };
      }

      // Razorpay receipt must be <= 40 chars
      const rawReceipt = `sub_${planId.substring(0, 15)}_${Date.now()}`;
      const safeReceipt = rawReceipt.substring(0, 40);

      // Create Razorpay order (amount in paise - Razorpay API requirement)
      const orderOptions = {
        amount: amountInPaise, // Only this goes to Razorpay in paise
        currency: "INR",
        receipt: safeReceipt,
        notes: {
          user_id: userId,
          plan_id: planId,
          payment_type: "subscription_payment",
          plan_name: plan.name,
          billing_cycle: plan.billing_cycle,
          ...(couponData && {
            coupon_id: couponData.coupon_id,
            coupon_code: couponData.coupon_code,
            original_amount: couponData.original_amount.toString(), // Store as string in notes
            discount_amount: couponData.discount_amount.toString(),
          }),
        },
      };

      const razorpayOrder = await razorpay.orders.create(orderOptions);

      // Store payment order in database (ALL AMOUNTS IN RUPEES)
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("v1_payment_orders")
        .insert({
          payable_type: "SUBSCRIPTION",
          payable_id: planId,
          amount: finalAmountRupees, // Stored in RUPEES
          currency: "INR",
          status: "CREATED",
          razorpay_order_id: razorpayOrder.id,
          metadata: {
            user_id: userId,
            plan_id: planId,
            payer_id: userId,
            payer_role: user.role,
            payment_type: "subscription_payment",
            plan_name: plan.name,
            billing_cycle: plan.billing_cycle,
            price: plan.price, // In rupees
            ...(couponData && {
              coupon_id: couponData.coupon_id,
              coupon_code: couponData.coupon_code,
              original_amount: couponData.original_amount, // In rupees
              discount_amount: couponData.discount_amount, // In rupees
            }),
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error(
          "[v1/PaymentService/createSubscriptionPaymentOrder] Database error:",
          orderError
        );
        return {
          success: false,
          message: "Failed to create payment order",
          error: orderError.message,
        };
      }

      // Convert Razorpay response from paise to rupees for our response
      const orderInRupees = {
        ...razorpayOrder,
        amount: this.paiseToRupees(razorpayOrder.amount),
        amount_paid: razorpayOrder.amount_paid ? this.paiseToRupees(razorpayOrder.amount_paid) : 0,
        amount_due: razorpayOrder.amount_due ? this.paiseToRupees(razorpayOrder.amount_due) : 0,
      };

      return {
        success: true,
        order: orderInRupees, // All amounts converted to rupees
        payment_order: paymentOrder, // Already in rupees
        plan: plan,
        coupon: couponData, // All amounts in rupees
        message: "Subscription payment order created successfully",
      };
    } catch (err) {
      console.error(
        "[v1/PaymentService/createSubscriptionPaymentOrder] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to create subscription payment order",
        error: err.message,
      };
    }
  }

  /**
   * Verify subscription payment and create subscription
   * Brand owner pays admin for subscription
   * @param {Object} paymentData - Payment verification data
   * @returns {Promise<Object>} Result with subscription
   */
  async verifySubscriptionPayment(paymentData) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        plan_id,
      } = paymentData;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return {
          success: false,
          message: "Missing required payment information",
        };
      }

      // Verify payment signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      if (razorpay_signature !== expectedSignature) {
        return {
          success: false,
          message: "Invalid payment signature",
        };
      }

      // Get payment order
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("*")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (orderError || !paymentOrder) {
        return {
          success: false,
          message: "Payment order not found",
        };
      }

      // Check if it's a subscription payment
      if (
        !paymentOrder.metadata ||
        paymentOrder.metadata.payment_type !== "subscription_payment"
      ) {
        return {
          success: false,
          message: "Invalid payment order type",
        };
      }

      // Normalize status
      paymentOrder.status =
        this.normalizeStatus(paymentOrder.status) || paymentOrder.status;

      // Check if payment already verified
      if (paymentOrder.status === "VERIFIED") {
        return {
          success: false,
          message: "Payment already verified",
        };
      }

      // Check for duplicate payment
      const { data: existingPayment } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("id")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .maybeSingle();

      if (existingPayment && existingPayment.id !== paymentOrder.id) {
        return {
          success: false,
          message: "Payment already processed",
        };
      }

      // Get plan_id from payment order metadata
      const orderPlanId = paymentOrder.metadata.plan_id;
      const userId = paymentOrder.metadata.user_id;

      // Validate plan_id matches if provided
      if (plan_id && plan_id !== orderPlanId) {
        return {
          success: false,
          message: "Plan ID mismatch with payment order",
        };
      }

      // Update payment order status
      const { error: updateError } = await supabaseAdmin
        .from("v1_payment_orders")
        .update({
          status: "VERIFIED",
          razorpay_payment_id: razorpay_payment_id,
          razorpay_signature: razorpay_signature,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentOrder.id);

      if (updateError) {
        console.error(
          "[v1/PaymentService/verifySubscriptionPayment] Update error:",
          updateError
        );
        return {
          success: false,
          message: "Failed to update payment order",
          error: updateError.message,
        };
      }

      // Create subscription using SubscriptionService
      const SubscriptionService = require("./subscriptionService");
      const subscriptionResult = await SubscriptionService.createSubscription(
        userId,
        orderPlanId,
        false // is_auto_renew - can be made configurable
      );

      if (!subscriptionResult.success) {
        // Payment is verified but subscription creation failed
        // This is a critical error - payment is done but subscription not created
        console.error(
          "[v1/PaymentService/verifySubscriptionPayment] Subscription creation failed after payment:",
          subscriptionResult
        );
        return {
          success: false,
          message:
            "Payment verified but subscription creation failed. Please contact support.",
          error: subscriptionResult.message,
        };
      }

      // Record coupon usage if coupon was applied
      const couponData = paymentOrder.metadata?.coupon_id
        ? {
            coupon_id: paymentOrder.metadata.coupon_id,
            coupon_code: paymentOrder.metadata.coupon_code,
            original_amount: paymentOrder.metadata.original_amount || paymentOrder.metadata.price,
            discount_amount: paymentOrder.metadata.discount_amount || 0,
            final_amount: paymentOrder.amount,
          }
        : null;

      if (couponData) {
        const CouponService = require("./couponService");
        const couponResult = await CouponService.applyCoupon(
          couponData.coupon_id,
          userId,
          subscriptionResult.subscription.id,
          couponData.original_amount, // All in rupees
          couponData.discount_amount, // All in rupees
          couponData.final_amount // All in rupees
        );

        if (!couponResult.success) {
          console.error(
            "[v1/PaymentService/verifySubscriptionPayment] Failed to record coupon usage:",
            couponResult
          );
          // Don't fail the payment if coupon recording fails, but log it
        }
      }

      return {
        success: true,
        message: "Payment verified and subscription created successfully",
        payment_order: {
          ...paymentOrder,
          status: "VERIFIED",
          razorpay_payment_id: razorpay_payment_id,
        },
        subscription: subscriptionResult.subscription,
        coupon: couponData,
      };
    } catch (err) {
      console.error(
        "[v1/PaymentService/verifySubscriptionPayment] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to verify subscription payment",
        error: err.message,
      };
    }
  }
}

module.exports = new PaymentService();
