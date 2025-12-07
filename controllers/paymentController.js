const paymentService = require("../utils/payment");
const enhancedBalanceService = require("../utils/enhancedBalanceService");
const { supabaseAdmin } = require("../supabase/client");
const { validationResult } = require("express-validator");
const crypto = require("crypto");
const Razorpay = require("razorpay");

// Initialize Razorpay only if environment variables are available
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

class PaymentController {
  /**
   * Get Razorpay config for request payments
   */
  async getPaymentConfig(req, res) {
    try {
      if (!razorpay) {
        return res.status(503).json({
          success: false,
          message: "Payment service is not configured",
        });
      }

      return res.json({
        success: true,
        config: {
          key_id: process.env.RAZORPAY_KEY_ID,
          currency: "INR",
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Create Razorpay order for a request payment
   */
  async createOrderForRequest(req, res) {
    try {
      const { request_id, amount, currency = "INR", notes = {} } = req.body;
      const userId = req.user.id;

      if (!request_id) {
        return res.status(400).json({
          success: false,
          message: "request_id is required",
        });
      }

      if (!razorpay) {
        return res.status(503).json({
          success: false,
          message: "Payment service is not configured. Please contact support.",
        });
      }

      // Get request details (lightweight)
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select("id, influencer_id, final_agreed_amount, campaign_id")
        .eq("id", request_id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Permission: ensure caller is the brand owner of the source
      let brandOwnerId = null;
      if (request.campaign_id) {
        const { data: campaign } = await supabaseAdmin
          .from("campaigns")
          .select("created_by")
          .eq("id", request.campaign_id)
          .single();
        brandOwnerId = campaign?.created_by || null;
      }

      if (!brandOwnerId || brandOwnerId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Only the brand owner can create payment orders",
        });
      }

      // Determine payable amount
      const payable = amount || request.final_agreed_amount;
      if (!payable || Number(payable) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // Razorpay receipt must be <= 40 chars
      const rawReceipt = `req_${request_id}_${Date.now()}`;
      const safeReceipt = rawReceipt.substring(0, 40);
      const orderOptions = {
        amount: Math.round(Number(payable) * 100),
        currency: currency || "INR",
        receipt: safeReceipt,
        notes: {
          ...notes,
          request_id,
          brand_owner_id: brandOwnerId,
          influencer_id: request.influencer_id,
          source_type: "campaign",
        },
      };

      const order = await razorpay.orders.create(orderOptions);

      return res.json({
        success: true,
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
          notes: order.notes || {},
        },
      });
    } catch (error) {
      console.error("Create request order error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
  /**
   * Process payment response from frontend
   */
  async processPayment(req, res) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        request_id,
        amount,
        payment_type, // 'approval' or 'completion'
      } = req.body;

      // Validate required fields
      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !request_id ||
        !amount ||
        !payment_type
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required payment information",
        });
      }

      // Process the payment
      const result = await paymentService.processPaymentResponse({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        request_id,
        amount,
        payment_type,
      });

      if (result.success) {
        res.json({
          success: true,
          payment_order: result.payment_order,
          escrow_hold: result.escrow_hold,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.error,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get transaction history for a user
   */
  async getTransactionHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, status } = req.query;

      const result = await paymentService.getTransactionHistory(
        userId,
        parseInt(page),
        parseInt(limit),
        status
      );

      if (result.success) {
        res.json({
          success: true,
          transactions: result.transactions,
          pagination: result.pagination,
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }



  /**
   * Get wallet balance with frozen amount
   */
  async getWalletBalance(req, res) {
    try {
      const userId = req.user.id;

      // Use enhanced balance service which handles wallet creation and retries
      const enhancedBalanceService = require('../utils/enhancedBalanceService');
      const result = await enhancedBalanceService.getWalletBalance(userId);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.error || "Failed to fetch wallet balance",
        });
      }

      const wallet = result.wallet;
      const balanceSummary = result.balance_summary || {};

      // Format response to match expected structure
      const balanceInfo = {
        // Withdrawable amounts (money user can withdraw)
        withdrawable_balance: balanceSummary.available_rupees || (wallet.balance_paise || 0) / 100,
        withdrawable_balance_paise: wallet.balance_paise || 0,

        // Frozen amounts (money held in escrow)
        frozen_balance: balanceSummary.frozen_rupees || (wallet.frozen_balance_paise || 0) / 100,
        frozen_balance_paise: wallet.frozen_balance_paise || 0,

        // Total amounts (withdrawable + frozen)
        total_balance: balanceSummary.total_rupees || ((wallet.balance_paise || 0) + (wallet.frozen_balance_paise || 0)) / 100,
        total_balance_paise: (wallet.balance_paise || 0) + (wallet.frozen_balance_paise || 0),

        // Legacy fields for compatibility
        available_balance: balanceSummary.available_rupees || (wallet.balance_paise || 0) / 100,
        balance_paise: wallet.balance_paise || 0,
      };

      res.json({
        success: true,
        message: "Wallet balance retrieved successfully",
        data: balanceInfo,
      });
    } catch (error) {
      console.error("Get wallet balance error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Withdraw available balance
   */
  async withdrawBalance(req, res) {
    try {
      const { amount } = req.body;
      const userId = req.user.id;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid withdrawal amount is required",
        });
      }

      // Get wallet details
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("id, balance")
        .eq("user_id", userId)
        .single();

      if (walletError) {
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }

      // Check if enough balance
      if (wallet.balance < amount) {
        return res.status(400).json({
          success: false,
          message: "Insufficient available balance",
        });
      }

      // Process withdrawal (integrate with payment gateway)
      // This is a placeholder - implement actual withdrawal logic
      const withdrawalId = `withdraw_${Date.now()}`;

      // Update wallet balance
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance: wallet.balance - amount,
        })
        .eq("id", wallet.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update wallet balance",
        });
      }

      // Record withdrawal transaction
      const { error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          amount: amount,
          type: "withdrawal",
          status: "completed",
          reference_id: withdrawalId,
        });

      if (transactionError) {
        return res.status(500).json({
          success: false,
          message: "Failed to record withdrawal transaction",
        });
      }

      res.json({
        success: true,
        message: "Withdrawal processed successfully",
        data: {
          withdrawal_id: withdrawalId,
          amount_withdrawn: amount,
          new_balance: wallet.balance - amount,
        },
      });
    } catch (error) {
      console.error("Withdraw balance error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(req, res) {
    try {
      const userId = req.user.id;

      const result = await paymentService.getPaymentStats(userId);

      if (result.success) {
        res.json({
          success: true,
          stats: result.stats,
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Create refund record
   */
  async createRefund(req, res) {
    try {
      const { payment_id, amount, reason } = req.body;
      const userId = req.user.id;

      // Check if user has permission to request refund
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .select(
          `
                    *,
                    wallets!inner (
                        user_id
                    )
                `
        )
        .eq("razorpay_payment_id", payment_id)
        .single();

      if (transactionError || !transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      if (transaction.wallets.user_id !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Process refund
      const refundResult = await paymentService.createRefundRecord(
        payment_id,
        amount,
        reason
      );

      if (refundResult.success) {
        res.json({
          success: true,
          refund: refundResult.refund,
          message: refundResult.message,
        });
      } else {
        res.status(500).json({
          success: false,
          message: refundResult.error,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get request payment details
   */
  async getRequestPaymentDetails(req, res) {
    try {
      const { request_id } = req.params;
      const userId = req.user.id;

      // Check if request exists and user has permission
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `
        )
        .eq("id", request_id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check permissions
      if (
        req.user.role === "brand_owner" &&
        request.campaigns.created_by !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role === "influencer" && request.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Calculate payment amounts
      const totalBudget = parseFloat(request.campaigns.budget);
      const approvalAmount = totalBudget * 0.5;
      const completionAmount = totalBudget * 0.5;

      res.json({
        success: true,
        request: request,
        payment_details: {
          total_budget: totalBudget,
          approval_amount: approvalAmount,
          completion_amount: completionAmount,
          approval_paid:
            request.status === "approved" ||
            request.status === "in_progress" ||
            request.status === "completed",
          completion_paid: request.status === "completed",
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

module.exports = {
  PaymentController: new PaymentController(),
};
