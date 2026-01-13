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
   * Convert Razorpay order object amounts from paise to rupees
   */
  convertRazorpayOrderToRupees(razorpayOrder) {
    if (!razorpayOrder) return null;
    
    return {
      ...razorpayOrder,
      amount: razorpayOrder.amount ? razorpayOrder.amount / 100 : 0,
      amount_paid: razorpayOrder.amount_paid ? razorpayOrder.amount_paid / 100 : 0,
      amount_due: razorpayOrder.amount_due ? razorpayOrder.amount_due / 100 : 0,
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
        .eq("application_id", applicationId)
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
          application_id: applicationId,
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

      // Get application_id from payment order (it's a required field)
      const orderApplicationId = paymentOrder.application_id;

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
   * Release payout to influencer (Admin only)
   * Admin releases payment to influencer after keeping commission
   */
  async releasePayoutToInfluencer(applicationId, adminUserId) {
    try {
      // Get verified payment order for this application
      const { data: paymentOrder, error: paymentsError } = await supabaseAdmin
        .from("v1_payment_orders")
        .select("*")
        .eq("application_id", applicationId)
        .eq("status", "VERIFIED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentsError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Database error:",
          paymentsError
        );
        return {
          success: false,
          message: "Failed to fetch payments",
          error: paymentsError.message,
        };
      }

      if (!paymentOrder) {
        return {
          success: false,
          message: "No verified payment found for this application",
        };
      }

      // Normalize status to UPPERCASE (in case of legacy lowercase values)
      paymentOrder.status = this.normalizeStatus(paymentOrder.status) || paymentOrder.status;

      // Check if payout already exists
      const { data: existingPayout, error: payoutCheckError } = await supabaseAdmin
        .from("v1_payouts")
        .select("id, status")
        .eq("application_id", applicationId)
        .maybeSingle();

      if (payoutCheckError && payoutCheckError.code !== "PGRST116") {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Payout check error:",
          payoutCheckError
        );
        return {
          success: false,
          message: "Failed to check existing payouts",
          error: payoutCheckError.message,
        };
      }

      if (existingPayout) {
        if (existingPayout.status === "RELEASED") {
          return {
            success: false,
            message: "Payout already released for this application",
          };
        }
        if (existingPayout.status === "PENDING") {
          return {
            success: false,
            message: "Payout already exists in PENDING status",
          };
        }
      }

      // Get application details
      const { data: application, error: applicationError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, influencer_id, phase")
        .eq("id", applicationId)
        .single();

      if (applicationError || !application) {
        return {
          success: false,
          message: "Application not found",
        };
      }

      if (application.phase !== "COMPLETED") {
        return {
          success: false,
          message: "Application must be completed before releasing payout",
        };
      }

      // Get influencer wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("v1_wallets")
        .select("*")
        .eq("user_id", application.influencer_id)
        .maybeSingle();

      if (walletError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Wallet error:",
          walletError
        );
        return {
          success: false,
          message: "Failed to fetch influencer wallet",
          error: walletError.message,
        };
      }

      // If wallet doesn't exist, create one
      let influencerWallet = wallet;
      if (!wallet) {
        const { data: newWallet, error: createWalletError } = await supabaseAdmin
          .from("v1_wallets")
          .insert({
            user_id: application.influencer_id,
            balance: 0.0,
          })
          .select()
          .single();

        if (createWalletError) {
          return {
            success: false,
            message: "Failed to create wallet",
            error: createWalletError.message,
          };
        }
        influencerWallet = newWallet;
      }

      // Calculate amount to release (net amount after commission, in rupees)
      const netAmount = paymentOrder.metadata?.net_amount || paymentOrder.amount - (paymentOrder.metadata?.commission_amount || 0);
      const currentBalance = influencerWallet.balance || 0;
      const newBalance = currentBalance + netAmount;

      // Create payout record first (status: PENDING)
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from("v1_payouts")
        .insert({
          application_id: applicationId,
          influencer_id: application.influencer_id,
          amount: netAmount, // Store in rupees
          status: "PENDING",
          released_by_admin_id: adminUserId,
        })
        .select()
        .single();

      if (payoutError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Payout creation error:",
          payoutError
        );
        return {
          success: false,
          message: "Failed to create payout record",
          error: payoutError.message,
        };
      }

      // Update wallet (balance is in rupees)
      const { error: updateWalletError } = await supabaseAdmin
        .from("v1_wallets")
        .update({
          balance: newBalance,
        })
        .eq("id", influencerWallet.id);

      if (updateWalletError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Wallet update error:",
          updateWalletError
        );
        // Update payout status to FAILED if wallet update fails
        await supabaseAdmin
          .from("v1_payouts")
          .update({ status: "FAILED" })
          .eq("id", payout.id);
        return {
          success: false,
          message: "Failed to update wallet",
          error: updateWalletError.message,
        };
      }

      // Create transaction record (amount in rupees)
      const { error: transactionError } = await supabaseAdmin
        .from("v1_transactions")
        .insert({
          wallet_id: influencerWallet.id,
          user_id: application.influencer_id,
          amount: netAmount,
          type: "credit",
          status: "completed",
          razorpay_payment_id: paymentOrder.razorpay_payment_id,
          razorpay_order_id: paymentOrder.razorpay_order_id,
          campaign_id: paymentOrder.metadata?.campaign_id,
          notes: `Payout released for application ${applicationId}`,
          balance_after: newBalance,
        });

      if (transactionError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Transaction error:",
          transactionError
        );
        // Don't fail if transaction record fails, payment is already processed
      }

      // Update payout status to RELEASED
      const { data: updatedPayout, error: updatePayoutError } = await supabaseAdmin
        .from("v1_payouts")
        .update({
          status: "RELEASED",
          released_at: new Date().toISOString(),
        })
        .eq("id", payout.id)
        .select()
        .single();

      if (updatePayoutError) {
        console.error(
          "[v1/PaymentService/releasePayoutToInfluencer] Payout update error:",
          updatePayoutError
        );
        // Don't fail if payout status update fails, wallet is already updated
      }

      return {
        success: true,
        message: "Payout released to influencer successfully",
        payout_amount: netAmount,
        commission_amount: paymentOrder.metadata?.commission_amount || 0,
        new_wallet_balance: newBalance,
        payout: updatedPayout || payout,
      };
    } catch (err) {
      console.error("[v1/PaymentService/releasePayoutToInfluencer] Exception:", err);
      return {
        success: false,
        message: "Failed to release payout",
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
        .eq("application_id", applicationId)
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
}

module.exports = new PaymentService();
