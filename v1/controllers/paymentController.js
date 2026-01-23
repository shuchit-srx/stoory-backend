const PaymentService = require("../services/paymentService");
const { validationResult } = require("express-validator");

/**
 * Payment Controller for Applications
 * Handles HTTP requests for payment-related endpoints
 */
class PaymentController {
  /**
   * Get payment config (Razorpay key) for frontend
   * GET /api/v1/payments/config
   */
  async getPaymentConfig(req, res) {
    try {
      const result = PaymentService.getPaymentConfig();

      if (!result.success) {
        return res.status(503).json({
          success: false,
          message: result.message || "Payment service is not configured",
        });
      }

      return res.status(200).json({
        success: true,
        config: result.config,
      });
    } catch (err) {
      console.error("[v1/PaymentController/getPaymentConfig] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Create payment order for application (Brand pays admin)
   * Only allowed when application is COMPLETED
   * POST /api/v1/payments/applications/:applicationId
   */
  async createApplicationPaymentOrder(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const applicationId = req.params.applicationId;
      const userId = req.user.id;

      const result = await PaymentService.createPaymentOrder(applicationId, userId);

      if (!result.success) {
        const statusCode =
          result.message === "Application not found" ||
          result.message === "User not found" ||
          result.message === "You don't have permission to pay for this application"
            ? 404
            : result.message === "Payment service is not configured"
            ? 503
            : result.message === "Payment can only be initiated for accepted applications" ||
              result.message === "Application does not have a valid agreed amount" ||
              result.message === "Payment already completed for this application" ||
              result.message === "Payment order already exists for this application"
            ? 400
            : 400;
        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to create payment order",
          error: result.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message || "Payment order created successfully",
        order: result.order,
        payment_order: result.payment_order,
        breakdown: result.breakdown,
      });
    } catch (err) {
      console.error(
        "[v1/PaymentController/createApplicationPaymentOrder] Exception:",
        err
      );
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Create bulk payment order for selected applications in a campaign
   * POST /api/v1/payments/campaigns/:campaignId/bulk
   */
  async createCampaignBulkPaymentOrder(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const campaignId = req.params.campaignId;
      const userId = req.user.id;
      const { application_ids } = req.body;

      const result = await PaymentService.createBulkPaymentOrderForCampaign(campaignId, userId, application_ids);

      if (!result.success) {
        const statusCode =
          result.message === "Campaign not found" ||
          result.message === "User not found"
            ? 404
            : result.message === "You don't have permission to pay for this campaign"
            ? 403
            : result.message === "Payment service is not configured"
            ? 503
            : result.message === "No accepted applications found for this campaign" ||
              result.message === "All accepted applications are already paid" ||
              result.message === "Invalid total amount for bulk payment" ||
              result.message === "Campaign does not have a valid platform fee percentage" ||
              result.message === "Bulk payment already completed for this campaign" ||
              result.message === "Bulk payment order already exists for this campaign"
            ? 400
            : 500;
        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to create bulk payment order",
          error: result.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message || "Bulk payment order created successfully",
        order: result.order,
        payment_order: result.payment_order,
        breakdown: result.breakdown,
        application_count: result.application_count,
        application_ids: result.application_ids,
      });
    } catch (err) {
      console.error(
        "[v1/PaymentController/createCampaignBulkPaymentOrder] Exception:",
        err
      );
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Verify payment
   * POST /api/v1/payments/verify
   */
  async verifyPayment(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        application_id,
      } = req.body;

      const result = await PaymentService.verifyPayment({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        application_id,
      });

      if (!result.success) {
        const statusCode =
          result.message === "Payment order not found" ||
          result.message === "Application not found"
            ? 404
            : result.message === "Invalid payment signature" ||
              result.message === "Payment already verified" ||
              result.message === "Payment already processed" ||
              result.message === "Application must be accepted before payment"
            ? 400
            : 500;
        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to verify payment",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Payment verified successfully",
        payment_order: result.payment_order,
      });
    } catch (err) {
      console.error("[v1/PaymentController/verifyPayment] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get payments for an application
   * GET /api/v1/payments/applications/:applicationId
   */
  async getApplicationPayments(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const applicationId = req.params.applicationId;
      const userId = req.user.id;

      // Verify application exists and user has permission
      const { supabaseAdmin } = require("../db/config");
      const { data: application, error: applicationError } = await supabaseAdmin
        .from("v1_applications")
        .select(`
          id,
          brand_id,
          influencer_id,
          v1_campaigns!inner(brand_id)
        `)
        .eq("id", applicationId)
        .single();

      if (applicationError || !application) {
        return res.status(404).json({
          success: false,
          message: "Application not found",
        });
      }

      // Check if user is brand owner, influencer, or admin
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Permission check: Brand owner, influencer, or admin can see payments
      const isBrandOwner = application.v1_campaigns.brand_id === userId;
      const isInfluencer = application.influencer_id === userId;
      const isAdmin = user.role === "ADMIN";

      if (!isBrandOwner && !isInfluencer && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view payments for this application",
        });
      }

      const result = await PaymentService.getApplicationPayments(applicationId);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch payments",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Payments fetched successfully",
        payments: result.payments,
      });
    } catch (err) {
      console.error("[v1/PaymentController/getApplicationPayments] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get transactions for a brand owner
   * GET /api/v1/payments/transactions
   */
  async getBrandTransactions(req, res) {
    try {
      const userId = req.user.id;
      
      // Standardized pagination - Default limit 20, max 100
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;
      const { type, status } = req.query;

      // Validate pagination
      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid limit. Must be >= 1",
        });
      }

      if (isNaN(offset) || offset < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offset. Must be >= 0",
        });
      }

      // Verify user is a brand owner
      const { supabaseAdmin } = require("../db/config");
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user is brand owner or admin
      if (user.role !== "BRAND_OWNER" && user.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners and admins can view transactions",
        });
      }

      // Build query with count for total
      let query = supabaseAdmin
        .from("v1_transactions")
        .select(`
          *,
          v1_applications(
            id,
            phase,
            v1_campaigns(
              id,
              title,
              brand_id
            )
          )
        `, { count: 'exact' })
        .eq("from_entity", userId) // Brand owner is the from_entity
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply filters
      if (type) {
        query = query.eq("type", type);
      }
      if (status) {
        query = query.eq("status", status);
      }

      const { data: transactions, error, count } = await query;

      if (error) {
        console.error("[v1/PaymentController/getBrandTransactions] Database error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch transactions",
          error: error.message,
        });
      }

      // Format transactions to remove v1_ prefixes
      const formattedTransactions = (transactions || []).map(txn => {
        const formatted = { ...txn };
        if (txn.v1_applications) {
          const { v1_campaigns, ...applicationData } = txn.v1_applications;
          formatted.application = {
            ...applicationData,
            campaign: v1_campaigns || null,
          };
          delete formatted.v1_applications;
        }
        return formatted;
      });

      const hasMore = (offset + limit) < (count || 0);

      return res.status(200).json({
        success: true,
        message: "Transactions fetched successfully",
        transactions: formattedTransactions,
        pagination: {
          limit,
          offset,
          count: formattedTransactions.length,
          total: count || 0,
          hasMore,
        },
      });
    } catch (err) {
      console.error("[v1/PaymentController/getBrandTransactions] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new PaymentController();
