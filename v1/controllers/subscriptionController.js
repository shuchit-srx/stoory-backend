const SubscriptionService = require("../services/subscriptionService");

/**
 * Subscription Controller
 * Handles HTTP requests for subscription-related endpoints
 */
class SubscriptionController {
  /**
   * Create a new subscription for authenticated brand user
   * POST /api/v1/subscriptions
   */
  async createSubscription(req, res) {
    try {
      const userId = req.user.id;
      const { plan_id, is_auto_renew } = req.body;

      if (!plan_id) {
        return res.status(400).json({
          success: false,
          message: "plan_id is required",
        });
      }

      const result = await SubscriptionService.createSubscription(
        userId,
        plan_id,
        is_auto_renew
      );

      if (!result.success) {
        const statusCode = result.message === "Plan not found or not active" ? 404 : 400;
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
      console.error("[v1/SubscriptionController/createSubscription] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get all subscriptions (Admin only)
   * GET /api/v1/subscriptions/all
   */
  async getAllSubscriptions(req, res) {
    try {
      const result = await SubscriptionService.getAllSubscriptions();

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch subscriptions",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Subscriptions fetched successfully",
        total_users_count: result.total_users_count,
        plans: result.plans,
      });
    } catch (err) {
      console.error("[v1/SubscriptionController/getAllSubscriptions] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get current subscription for any brand (Admin only)
   * GET /api/v1/subscriptions/current/:userId
   */
  async getCurrentSubscription(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const result = await SubscriptionService.getCurrentSubscription(userId);

      if (!result.success) {
        const statusCode = result.message === "User not found" || result.message === "User is not a BRAND_OWNER" ? 404 : 500;
        return res.status(statusCode).json({
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
      console.error("[v1/SubscriptionController/getCurrentSubscription] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Cancel subscription for authenticated brand user (Brand only)
   * DELETE /api/v1/subscriptions
   */
  async cancelSubscription(req, res) {
    try {
      const userId = req.user.id;

      const result = await SubscriptionService.cancelSubscription(userId);

      if (!result.success) {
        const statusCode = result.message === "No active subscription found" ? 404 : 400;
        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to cancel subscription",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Subscription cancelled successfully",
        subscription: result.subscription,
      });
    } catch (err) {
      console.error("[v1/SubscriptionController/cancelSubscription] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Cancel subscription for any brand (Admin only)
   * DELETE /api/v1/subscriptions/:userId
   */
  async cancelSubscriptionForBrand(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const result = await SubscriptionService.cancelSubscription(userId);

      if (!result.success) {
        const statusCode = result.message === "No active subscription found" ? 404 : 400;
        return res.status(statusCode).json({
          success: false,
          message: result.message || "Failed to cancel subscription",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || "Subscription cancelled successfully",
        subscription: result.subscription,
      });
    } catch (err) {
      console.error("[v1/SubscriptionController/cancelSubscriptionForBrand] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new SubscriptionController();

