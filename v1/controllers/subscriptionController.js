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
}

module.exports = new SubscriptionController();

