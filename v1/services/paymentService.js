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
   * @param {number} platformFeeAmount - Optional platform fee fixed amount from campaign/application
   */
  async calculateCommissionBreakdown(amount, platformFeePercentage = null, platformFeeAmount = null) {
    try {
      // All calculations in rupees
      const totalAmount = parseFloat(amount);
      let commissionAmount = 0;
      let commissionPercentage = null;

      // If platform_fee_amount is provided, use it directly (fixed amount)
      if (platformFeeAmount !== null && platformFeeAmount !== undefined && platformFeeAmount > 0) {
        commissionAmount = parseFloat(platformFeeAmount);
        commissionPercentage = (commissionAmount / totalAmount) * 100; // Calculate percentage for reference
      } 
      // Otherwise, use platform_fee_percentage if provided
      else if (platformFeePercentage !== null && platformFeePercentage !== undefined) {
        commissionPercentage = parseFloat(platformFeePercentage);
        commissionAmount = (totalAmount * commissionPercentage) / 100;
      } 
      // Fallback: Get current admin settings (non-expired) - for backward compatibility
      else {
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
        commissionAmount = (totalAmount * commissionPercentage) / 100;
      }

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

      // Get application with campaign details including budget, platform_fee_percentage, and platform_fee_amount
      const { data: application, error: applicationError } = await supabaseAdmin
        .from("v1_applications")
        .select(`
          *,
          v1_campaigns!inner(
            id,
            brand_id,
            title,
            budget,
            platform_fee_percentage,
            platform_fee_amount,
            net_amount
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

      // Get payment amount: use budget_amount from application first, fallback to campaign budget
      const applicationBudgetAmount = application.budget_amount;
      const campaignBudget = application.v1_campaigns.budget;
      
      // Determine payment amount: prefer application budget_amount, fallback to campaign budget
      const paymentAmount = applicationBudgetAmount ?? campaignBudget;

      if (paymentAmount === null || paymentAmount === undefined || paymentAmount <= 0) {
        return {
          success: false,
          message: "Application does not have a valid budget amount and campaign budget is also missing",
        };
      }

      // Get platform fee from application first, fallback to campaign
      // Prefer platform_fee_amount (fixed) over platform_fee_percentage if both exist
      const platformFeeAmount = application.platform_fee_amount ?? application.v1_campaigns.platform_fee_amount ?? null;
      const platformFeePercentage = application.platform_fee_percentage ?? application.v1_campaigns.platform_fee_percentage ?? null;

      if (platformFeeAmount === null && platformFeePercentage === null) {
        return {
          success: false,
          message: "Application and campaign do not have a valid platform fee (percentage or amount)",
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

      // Calculate commission breakdown using payment amount and platform fee (amount or percentage)
      const breakdown = await this.calculateCommissionBreakdown(paymentAmount, platformFeePercentage, platformFeeAmount);

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
   * Create bulk payment order for selected applications in a campaign
   * Each application can only be in one payment order
   * Multiple payment orders can exist for different groups of applications
   * @param {string} campaignId - Campaign ID
   * @param {string} userId - User ID
   * @param {string[]} applicationIds - Array of application IDs to include in payment
   */
  async createBulkPaymentOrderForCampaign(campaignId, userId, applicationIds = []) {
    try {
      if (!razorpay) {
        return {
          success: false,
          message: "Payment service is not configured",
        };
      }

      // Validate application_ids
      if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
        return {
          success: false,
          message: "application_ids array is required and must not be empty",
        };
      }

      // Get campaign with platform_fee_percentage, platform_fee_amount, and net_amount
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, brand_id, title, platform_fee_percentage, platform_fee_amount, net_amount, requires_script")
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

      // Get selected applications and validate they belong to this campaign and are ACCEPTED
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, budget_amount, agreed_amount, phase, campaign_id, platform_fee_percentage, platform_fee_amount")
        .in("id", applicationIds)
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
          message: "No accepted applications found for the selected IDs in this campaign",
        };
      }

      // Check if all requested applications were found
      if (applications.length !== applicationIds.length) {
        const foundIds = new Set(applications.map(a => a.id));
        const missingIds = applicationIds.filter(id => !foundIds.has(id));
        return {
          success: false,
          message: `Some applications not found or not in ACCEPTED phase: ${missingIds.join(", ")}`,
        };
      }

      // Check which applications already have verified payments (APPLICATION type)
      const { data: existingApplicationPayments, error: existingAppPaymentsError } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("payable_type, payable_id, status")
        .eq("payable_type", "APPLICATION")
        .in("payable_id", applicationIds);

      if (existingAppPaymentsError) {
        console.error("[v1/PaymentService/createBulkPaymentOrderForCampaign] Error checking existing application payments:", existingAppPaymentsError);
      }

      // Check which applications are already in CAMPAIGN payment orders via v1_application_payments
      const { data: existingBulkPayments, error: existingBulkPaymentsError } = await supabaseAdmin
        .from("v1_application_payments")
        .select(`
          application_id,
          payment_order_id,
          v1_payment_orders!inner(
            id,
            status,
            payable_type
          )
        `)
        .in("application_id", applicationIds)
        .eq("v1_payment_orders.payable_type", "CAMPAIGN");

      if (existingBulkPaymentsError) {
        console.error("[v1/PaymentService/createBulkPaymentOrderForCampaign] Error checking existing bulk payments:", existingBulkPaymentsError);
      }

      // Collect all paid application IDs
      const paidAppIds = new Set();

      // Add applications with verified APPLICATION payments
      (existingApplicationPayments || []).forEach(p => {
        const normalizedStatus = this.normalizeStatus(p.status) || p.status;
        if (normalizedStatus === "VERIFIED") {
          paidAppIds.add(p.payable_id);
        }
      });

      // Add applications in verified CAMPAIGN payment orders
      (existingBulkPayments || []).forEach(bp => {
        const normalizedStatus = this.normalizeStatus(bp.v1_payment_orders.status) || bp.v1_payment_orders.status;
        if (normalizedStatus === "VERIFIED") {
          paidAppIds.add(bp.application_id);
        }
      });

      // Filter out already paid applications
      const payableApplications = applications.filter(a => !paidAppIds.has(a.id));

      if (payableApplications.length === 0) {
        return {
          success: false,
          message: "All selected applications are already paid",
        };
      }

      if (payableApplications.length !== applicationIds.length) {
        const alreadyPaidIds = applicationIds.filter(id => paidAppIds.has(id));
        return {
          success: false,
          message: `Some applications are already paid: ${alreadyPaidIds.join(", ")}`,
        };
      }

      // Aggregate budget_amount of all payable applications
      // For each application: use budget_amount first, fallback to campaign budget
      const totalAmount = payableApplications.reduce((sum, app) => {
        // Use application budget_amount first, fallback to campaign budget
        const amount = Number(app.budget_amount ?? campaign.budget ?? 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);

      if (!totalAmount || totalAmount <= 0) {
        return {
          success: false,
          message: "Invalid total amount for bulk payment. Applications must have budget_amount or campaign must have budget",
        };
      }

      // Get platform fee from applications first, fallback to campaign
      // Check if any application has platform_fee_amount or platform_fee_percentage
      let platformFeeAmount = null;
      let platformFeePercentage = null;
      
      // Find first application with platform fee (prefer amount over percentage)
      const appWithFeeAmount = payableApplications.find(app => 
        app.platform_fee_amount !== null && app.platform_fee_amount !== undefined && app.platform_fee_amount > 0
      );
      
      if (appWithFeeAmount) {
        // Use fixed amount from application
        platformFeeAmount = appWithFeeAmount.platform_fee_amount;
      } else {
        // Check for percentage in applications
        const appWithFeePercentage = payableApplications.find(app => 
          app.platform_fee_percentage !== null && app.platform_fee_percentage !== undefined
        );
        
        if (appWithFeePercentage) {
          platformFeePercentage = appWithFeePercentage.platform_fee_percentage;
        } else {
          // Fallback to campaign: prefer amount over percentage
          platformFeeAmount = campaign.platform_fee_amount ?? null;
          platformFeePercentage = campaign.platform_fee_percentage ?? null;
        }
      }

      if (platformFeeAmount === null && platformFeePercentage === null) {
        return {
          success: false,
          message: "Applications and campaign do not have a valid platform fee (percentage or amount)",
        };
      }

      // Calculate commission breakdown using total amount and platform fee (amount or percentage)
      const breakdown = await this.calculateCommissionBreakdown(totalAmount, platformFeePercentage, platformFeeAmount);

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

      // Create entries in v1_application_payments table
      const applicationPaymentEntries = payableApplications.map(app => ({
        payment_order_id: paymentOrder.id,
        application_id: app.id,
      }));

      const { error: applicationPaymentsError } = await supabaseAdmin
        .from("v1_application_payments")
        .insert(applicationPaymentEntries);

      if (applicationPaymentsError) {
        console.error(
          "[v1/PaymentService/createBulkPaymentOrderForCampaign] Error creating application payments:",
          applicationPaymentsError
        );
        // Rollback payment order creation
        await supabaseAdmin
          .from("v1_payment_orders")
          .delete()
          .eq("id", paymentOrder.id);
        return {
          success: false,
          message: "Failed to create application payment records",
          error: applicationPaymentsError.message,
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

      // Handle different payment types
      let applicationsToUpdate = [];
      let campaignData = null;

      if (paymentOrder.payable_type === "APPLICATION") {
        // Single application payment
        const orderApplicationId = paymentOrder.payable_id;

        // If application_id is provided in request, validate it matches
        if (application_id && application_id !== orderApplicationId) {
          return {
            success: false,
            message: "Application ID mismatch with payment order",
          };
        }

        // Get application
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

        if (appData.phase !== "ACCEPTED") {
          return {
            success: false,
            message: "Application must be accepted before payment",
          };
        }

        applicationsToUpdate = [appData];
        campaignData = appData.v1_campaigns;

      } else if (paymentOrder.payable_type === "CAMPAIGN") {
        // Bulk campaign payment - get all applications from v1_application_payments
        const { data: applicationPayments, error: appPaymentsError } = await supabaseAdmin
          .from("v1_application_payments")
          .select(`
            application_id,
            v1_applications!inner(
              id,
              phase,
              campaign_id,
              v1_campaigns!inner(
                id,
                brand_id
              )
            )
          `)
          .eq("payment_order_id", paymentOrder.id);

        if (appPaymentsError) {
          return {
            success: false,
            message: "Failed to load applications for bulk payment",
            error: appPaymentsError.message,
          };
        }

        if (!applicationPayments || applicationPayments.length === 0) {
          return {
            success: false,
            message: "No applications found for this bulk payment order",
          };
        }

        // Validate all applications are in ACCEPTED phase
        const invalidApplications = applicationPayments.filter(
          ap => ap.v1_applications.phase !== "ACCEPTED"
        );

        if (invalidApplications.length > 0) {
          return {
            success: false,
            message: `Some applications are not in ACCEPTED phase: ${invalidApplications.map(ap => ap.application_id).join(", ")}`,
          };
        }

        applicationsToUpdate = applicationPayments.map(ap => ap.v1_applications);
        if (applicationsToUpdate.length > 0) {
          campaignData = applicationsToUpdate[0].v1_campaigns;
        }
      }

      // Update application phases if we have applications
      if (applicationsToUpdate.length > 0 && campaignData) {
        // Get campaign to check requires_script
        const { data: campaign, error: campaignError } = await supabaseAdmin
          .from("v1_campaigns")
          .select("requires_script")
          .eq("id", campaignData.id)
          .maybeSingle();

        if (campaignError) {
          console.error("[v1/PaymentService/verifyPayment] Campaign fetch error:", campaignError);
        }

        // Determine next phase based on requires_script
        const nextPhase = campaign?.requires_script === true ? 'SCRIPT' : 'WORK';

        // Update all application phases
        const applicationIds = applicationsToUpdate.map(app => app.id);
        const { error: phaseUpdateError } = await supabaseAdmin
          .from("v1_applications")
          .update({
            phase: nextPhase
          })
          .in("id", applicationIds);

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

      // Insert transaction records into v1_transactions after payment verification
      if (applicationsToUpdate.length > 0 && campaignData) {
        try {
          const brandOwnerId = campaignData.brand_id;
          
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

          if (paymentOrder.payable_type === "APPLICATION") {
            // Single application - one transaction
            const application = applicationsToUpdate[0];
            const grossAmount = paymentOrder.amount || paymentOrder.metadata?.budget_amount || 0;
            const platformFee = paymentOrder.metadata?.commission_amount || 0;
            const netAmount = paymentOrder.metadata?.net_amount || (grossAmount - platformFee);

            const { error: transactionError } = await supabaseAdmin
              .from("v1_transactions")
              .insert({
                application_id: application.id,
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
            }
          } else if (paymentOrder.payable_type === "CAMPAIGN") {
            // Bulk campaign - one transaction per application
            // Calculate per-application amounts
            const totalGrossAmount = paymentOrder.amount || paymentOrder.metadata?.total_budget_amount || 0;
            const totalPlatformFee = paymentOrder.metadata?.commission_amount || 0;
            const totalNetAmount = paymentOrder.metadata?.net_amount || (totalGrossAmount - totalPlatformFee);

            // Get individual application amounts from metadata or calculate proportionally
            const applicationIds = applicationsToUpdate.map(app => app.id);
            const applicationAmounts = paymentOrder.metadata?.application_ids 
              ? await Promise.all(
                  applicationIds.map(async (appId) => {
                    const { data: app } = await supabaseAdmin
                      .from("v1_applications")
                      .select("budget_amount, agreed_amount")
                      .eq("id", appId)
                      .maybeSingle();
                    return {
                      application_id: appId,
                      amount: app?.budget_amount || app?.agreed_amount || 0,
                    };
                  })
                )
              : [];

            // Calculate per-application fees proportionally
            const totalAppAmount = applicationAmounts.reduce((sum, a) => sum + a.amount, 0);
            
            const transactionRecords = applicationsToUpdate.map((application) => {
              const appAmount = applicationAmounts.find(a => a.application_id === application.id)?.amount || 0;
              const proportion = totalAppAmount > 0 ? appAmount / totalAppAmount : 1 / applicationsToUpdate.length;
              
              return {
                application_id: application.id,
                type: "BRAND_PAYMENT",
                from_entity: brandOwnerId,
                to_entity: adminUserId,
                gross_amount: appAmount || (totalGrossAmount * proportion),
                platform_fee: totalPlatformFee * proportion,
                net_amount: (appAmount || (totalGrossAmount * proportion)) - (totalPlatformFee * proportion),
                status: "COMPLETED",
              };
            });

            const { error: transactionError } = await supabaseAdmin
              .from("v1_transactions")
              .insert(transactionRecords);

            if (transactionError) {
              console.error(
                "[v1/PaymentService/verifyPayment] Transaction insert error:",
                transactionError
              );
            }
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

      // Send notifications for each application
      if (applicationsToUpdate.length > 0 && campaignData) {
        try {
          const NotificationService = require('./notificationService');
          for (const app of applicationsToUpdate) {
            if (campaignData.brand_id && app.influencer_id) {
              await NotificationService.notifyPaymentCompleted(
                app.id,
                campaignData.brand_id,
                app.influencer_id
              );
            }
          }
        } catch (notifError) {
          console.error('[v1/PaymentService/verifyPayment] Failed to send notifications:', notifError);
          // Don't fail payment verification if notifications fail
        }
      }

      return {
        success: true,
        payment_order: updatedOrder,
        message: "Payment verified successfully",
        ...(paymentOrder.payable_type === "CAMPAIGN" && {
          applications_updated: applicationsToUpdate.length,
        }),
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
