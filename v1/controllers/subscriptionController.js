const { validationResult } = require("express-validator");
const SubscriptionService = require("../services/subscriptionService");

/**
 * Subscription Controller
 * Handles HTTP requests for subscription-related endpoints
 */
class SubscriptionController {
  /**
   * Create a new subscription (BRAND_OWNER only)
   * POST /api/v1/subscriptions
   */
  async createSubscription(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const userId = req.user.id;
      const { plan_id, is_auto_renew } = req.body;

      const result = await SubscriptionService.createSubscription(
        userId,
        plan_id,
        is_auto_renew
      );

      if (!result.success) {
        const statusCode =
          result.message === "Plan not found" ||
          result.message === "User not found"
            ? 404
            : result.message === "User already has an active subscription" ||
              result.message === "Plan is not active"
            ? 400
            : 500;

        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to create subscription",
          error: result.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message || "Subscription created successfully",
        subscription: result.subscription,
      });
    } catch (err) {
      console.error(
        "[v1/SubscriptionController/createSubscription] Exception:",
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
   * Get subscription status and details (BRAND_OWNER only)
   * GET /api/v1/subscriptions/status
   */
  async getSubscriptionStatus(req, res) {
    try {
      const userId = req.user.id;

      const result = await SubscriptionService.getUserSubscription(userId);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch subscription",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Subscription fetched successfully",
        subscription: result.subscription,
      });
    } catch (err) {
      console.error(
        "[v1/SubscriptionController/getSubscriptionStatus] Exception:",
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
   * Create subscription payment order
   * POST /api/v1/subscriptions/payment/order
   * Brand owner pays admin for subscription
   */
  async createSubscriptionPaymentOrder(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { plan_id } = req.body;

      const PaymentService = require("../services/paymentService");
      const result = await PaymentService.createSubscriptionPaymentOrder(
        userId,
        plan_id
      );

      if (!result.success) {
        const statusCode =
          result.message === "User not found" ||
          result.message === "Plan not found or not active"
            ? 404
            : result.message === "Payment service is not configured"
            ? 503
            : result.message === "User already has an active subscription" ||
              result.message === "Payment already completed for this subscription" ||
              result.message === "Payment order already exists for this subscription" ||
              result.message === "Only brand owners can create subscriptions"
            ? 400
            : 500;

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
        plan: result.plan,
      });
    } catch (err) {
      console.error(
        "[v1/SubscriptionController/createSubscriptionPaymentOrder] Exception:",
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
   * Verify subscription payment and create subscription
   * POST /api/v1/subscriptions/payment/verify
   * Brand owner pays admin for subscription
   */
  async verifySubscriptionPayment(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        plan_id,
      } = req.body;

      const PaymentService = require("../services/paymentService");
      const result = await PaymentService.verifySubscriptionPayment({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        plan_id,
      });

      if (!result.success) {
        const statusCode =
          result.message === "Payment order not found"
            ? 404
            : result.message === "Invalid payment signature" ||
              result.message === "Payment already verified" ||
              result.message === "Payment already processed" ||
              result.message === "Invalid payment order type" ||
              result.message === "Plan ID mismatch with payment order"
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
        message:
          result.message ||
          "Payment verified and subscription created successfully",
        payment_order: result.payment_order,
        subscription: result.subscription,
      });
    } catch (err) {
      console.error(
        "[v1/SubscriptionController/verifySubscriptionPayment] Exception:",
        err
      );
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new SubscriptionController();

