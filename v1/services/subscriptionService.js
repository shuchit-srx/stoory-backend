const { supabaseAdmin } = require("../db/config");

/**
 * Subscription Service
 * Handles business logic for subscription operations
 */
class SubscriptionService {
  /**
   * Calculate end date based on billing cycle
   * @param {string} billingCycle - MONTHLY or YEARLY
   * @param {Date} startDate - Start date of subscription
   * @returns {Date} End date
   */
  calculateEndDate(billingCycle, startDate) {
    const date = new Date(startDate);

    switch (billingCycle.toUpperCase()) {
      case "MONTHLY":
        date.setMonth(date.getMonth() + 1);
        break;
      case "YEARLY":
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        throw new Error("Invalid billing cycle. Must be MONTHLY or YEARLY");
    }

    return date;
  }

  /**
   * Create a new subscription for a user
   * @param {string} userId - User ID
   * @param {string} planId - Plan ID
   * @param {boolean} isAutoRenew - Whether subscription should auto-renew
   * @returns {Promise<Object>} Result object with success status and data
   */
  async createSubscription(userId, planId, isAutoRenew = false) {
    try {
      // Validate inputs
      if (!userId || typeof userId !== "string") {
        return {
          success: false,
          message: "user_id is required and must be a valid UUID",
        };
      }

      if (!planId || typeof planId !== "string") {
        return {
          success: false,
          message: "plan_id is required and must be a valid UUID",
        };
      }

      // Check if plan exists and is active
      const { data: plan, error: planError } = await supabaseAdmin
        .from("v1_plans")
        .select("*")
        .eq("id", planId)
        .single();

      if (planError || !plan) {
        return {
          success: false,
          message: "Plan not found",
        };
      }

      if (!plan.is_active) {
        return {
          success: false,
          message: "Plan is not active",
        };
      }

      // Check if user exists
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Check if user already has an active subscription
      const { data: existingSubscriptions, error: existingError } =
        await supabaseAdmin
          .from("v1_subscriptions")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "ACTIVE");

      if (existingError) {
        console.error(
          "[v1/SubscriptionService/createSubscription] Error checking existing subscription:",
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

      // Calculate subscription dates
      const startDate = new Date();
      const endDate = this.calculateEndDate(plan.billing_cycle, startDate);

      // Create subscription
      const subscriptionData = {
        user_id: userId,
        plan_id: planId,
        status: "ACTIVE",
        start_date: startDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
        end_date: endDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
        is_auto_renew: Boolean(isAutoRenew),
      };

      const { data: subscription, error: insertError } = await supabaseAdmin
        .from("v1_subscriptions")
        .insert(subscriptionData)
        .select()
        .single();

      if (insertError) {
        console.error(
          "[v1/SubscriptionService/createSubscription] Database error:",
          insertError
        );
        return {
          success: false,
          message: "Failed to create subscription",
          error: insertError.message,
        };
      }

      // Fetch subscription with plan details
      const { data: subscriptionWithPlan, error: fetchError } =
        await supabaseAdmin
          .from("v1_subscriptions")
          .select(
            `
            *,
            v1_plans (
              id,
              name,
              price,
              billing_cycle,
              features,
              is_active
            )
          `
          )
          .eq("id", subscription.id)
          .single();

      if (fetchError) {
        console.error(
          "[v1/SubscriptionService/createSubscription] Error fetching subscription with plan:",
          fetchError
        );
        // Return subscription without plan details if fetch fails
        return {
          success: true,
          subscription: subscription,
          message: "Subscription created successfully",
        };
      }

      return {
        success: true,
        subscription: subscriptionWithPlan,
        message: "Subscription created successfully",
      };
    } catch (err) {
      console.error(
        "[v1/SubscriptionService/createSubscription] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to create subscription",
        error: err.message,
      };
    }
  }

  /**
   * Get user's current subscription with plan details
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Result object with success status and subscription data
   */
  async getUserSubscription(userId) {
    try {
      // Validate input
      if (!userId || typeof userId !== "string") {
        return {
          success: false,
          message: "user_id is required and must be a valid UUID",
        };
      }

      // Get the most recent subscription
      const { data: subscriptions, error: fetchError } = await supabaseAdmin
        .from("v1_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (fetchError) {
        console.error(
          "[v1/SubscriptionService/getUserSubscription] Database error:",
          fetchError
        );
        return {
          success: false,
          message: "Failed to fetch subscription",
          error: fetchError.message,
        };
      }

      // If no subscription found
      if (!subscriptions || subscriptions.length === 0) {
        return {
          success: true,
          subscription: null,
          message: "No subscription found",
        };
      }

      const subscription = subscriptions[0];

      // Calculate days remaining (if active)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = new Date(subscription.end_date);
      endDate.setHours(0, 0, 0, 0);

      let daysRemaining = null;
      if (subscription.status === "ACTIVE") {
        const diffTime = endDate - today;
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      // Remove user_id and return only needed fields
      const { user_id, ...subscriptionData } = subscription;

      return {
        success: true,
        subscription: {
          ...subscriptionData,
          days_remaining: daysRemaining,
        },
        message: "Subscription fetched successfully",
      };
    } catch (err) {
      console.error(
        "[v1/SubscriptionService/getUserSubscription] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to fetch subscription",
        error: err.message,
      };
    }
  }
}

module.exports = new SubscriptionService();

