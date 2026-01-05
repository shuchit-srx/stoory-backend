const { supabaseAdmin } = require("../db/config");

/**
 * Subscription Service
 * Handles business logic for subscription operations
 */
class SubscriptionService {
  /**
   * Calculate end date based on billing cycle
   */
  calculateEndDate(billingCycle, startDate) {
    const date = new Date(startDate);
    const billingCycleUpper = billingCycle?.toUpperCase();

    switch (billingCycleUpper) {
      case "MONTHLY":
        date.setMonth(date.getMonth() + 1);
        break;
      case "YEARLY":
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        date.setMonth(date.getMonth() + 1); // Default to 1 month
    }

    return date.toISOString().split("T")[0]; // Return YYYY-MM-DD format
  }

  /**
   * Create a new subscription for a brand user
   * Creates subscription from an active plan
   */
  async createSubscription(userId, planId, isAutoRenew = false) {
    try {
      // Validate plan exists and is active
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

      // Calculate dates
      const startDate = new Date().toISOString().split("T")[0]; // Today in YYYY-MM-DD format
      const endDate = this.calculateEndDate(plan.billing_cycle, startDate);

      // Create subscription
      const subscriptionData = {
        user_id: userId,
        plan_id: planId,
        status: "ACTIVE",
        start_date: startDate,
        end_date: endDate,
        is_auto_renew: Boolean(isAutoRenew),
      };

      const { data, error } = await supabaseAdmin
        .from("v1_subscriptions")
        .insert(subscriptionData)
        .select(`
          *,
          v1_plans(
            *
          )
        `)
        .single();

      if (error) {
        console.error("[v1/SubscriptionService/createSubscription] Database error:", error);
        return {
          success: false,
          message: "Failed to create subscription",
          error: error.message,
        };
      }

      // Transform the data to rename v1_plans to plan
      const { v1_plans, ...subscriptionDataOut } = data;
      const subscription = {
        ...subscriptionDataOut,
        plan: v1_plans || null,
      };

      return {
        success: true,
        subscription: subscription,
        message: "Subscription created successfully",
      };
    } catch (err) {
      console.error("[v1/SubscriptionService/createSubscription] Exception:", err);
      return {
        success: false,
        message: "Failed to create subscription",
        error: err.message,
      };
    }
  }

  /**
   * Get all subscriptions (Admin only)
   * Returns plans with users nested inside each plan, and total users count
   */
  async getAllSubscriptions() {
    try {
      // Get all plans
      const { data: plans, error: plansError } = await supabaseAdmin
        .from("v1_plans")
        .select("*")
        .order("created_at", { ascending: false });

      if (plansError) {
        console.error("[v1/SubscriptionService/getAllSubscriptions] Plans error:", plansError);
        return {
          success: false,
          message: "Failed to fetch plans",
          error: plansError.message,
        };
      }

      // Get all subscriptions with user details
      const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
        .from("v1_subscriptions")
        .select(`
          id,
          user_id,
          plan_id,
          status,
          start_date,
          end_date,
          is_auto_renew,
          created_at,
          v1_users(
            id,
            phone_number,
            role
          )
        `)
        .order("created_at", { ascending: false });

      if (subscriptionsError) {
        console.error("[v1/SubscriptionService/getAllSubscriptions] Subscriptions error:", subscriptionsError);
        return {
          success: false,
          message: "Failed to fetch subscriptions",
          error: subscriptionsError.message,
        };
      }

      // Group subscriptions by plan_id and build user list for each plan
      const subscriptionsByPlan = {};
      const uniqueUserIds = new Set();

      (subscriptions || []).forEach((subscription) => {
        const planId = subscription.plan_id;
        if (!subscriptionsByPlan[planId]) {
          subscriptionsByPlan[planId] = [];
        }

        // Transform subscription data
        const { v1_users, ...subscriptionData } = subscription;
        subscriptionsByPlan[planId].push({
          ...subscriptionData,
          user: v1_users || null,
        });

        // Track unique users for total count
        if (v1_users && v1_users.id) {
          uniqueUserIds.add(v1_users.id);
        }
      });

      // Build plans array with users nested inside
      const plansWithUsers = (plans || []).map((plan) => {
        const planSubscriptions = subscriptionsByPlan[plan.id] || [];
        // Extract users from subscriptions
        const users = planSubscriptions.map((sub) => ({
          id: sub.user?.id || null,
          phone: sub.user?.phone_number || null,
          role: sub.user?.role || null,
          subscription: {
            id: sub.id,
            status: sub.status,
            start_date: sub.start_date,
            end_date: sub.end_date,
            is_auto_renew: sub.is_auto_renew,
            created_at: sub.created_at,
          },
        }));

        return {
          ...plan,
          users: users,
        };
      });

      return {
        success: true,
        total_users_count: uniqueUserIds.size,
        plans: plansWithUsers,
        message: "Subscriptions fetched successfully",
      };
    } catch (err) {
      console.error("[v1/SubscriptionService/getAllSubscriptions] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch subscriptions",
        error: err.message,
      };
    }
  }

  /**
   * Get current subscription for any brand (Admin only)
   * Returns the active subscription for the specified user
   */
  async getCurrentSubscription(userId) {
    try {
      // First verify the user exists and is a BRAND_OWNER
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

      if (user.role !== "BRAND_OWNER") {
        return {
          success: false,
          message: "User is not a BRAND_OWNER",
        };
      }

      const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

      const { data, error } = await supabaseAdmin
        .from("v1_subscriptions")
        .select(`
          *,
          v1_plans(
            *
          )
        `)
        .eq("user_id", userId)
        .eq("status", "ACTIVE")
        .lte("start_date", currentDate)
        .gte("end_date", currentDate)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[v1/SubscriptionService/getCurrentSubscription] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch subscription",
          error: error.message,
        };
      }

      // Transform the data to rename v1_plans to plan
      let subscription = null;
      if (data) {
        const { v1_plans, ...subscriptionData } = data;
        subscription = {
          ...subscriptionData,
          plan: v1_plans || null,
        };
      }

      return {
        success: true,
        subscription: subscription,
        message: subscription ? "Subscription fetched successfully" : "No active subscription found",
      };
    } catch (err) {
      console.error("[v1/SubscriptionService/getCurrentSubscription] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch subscription",
        error: err.message,
      };
    }
  }

  /**
   * Cancel a subscription
   * For brands: cancels their own subscription
   * For admin: can cancel any brand's subscription
   */
  async cancelSubscription(userId, subscriptionId = null) {
    try {
      // Build query to find active subscription
      let query = supabaseAdmin
        .from("v1_subscriptions")
        .select(`
          *,
          v1_plans(
            *
          )
        `)
        .eq("user_id", userId)
        .eq("status", "ACTIVE");

      // If subscriptionId is provided, filter by it (for admin use)
      if (subscriptionId) {
        query = query.eq("id", subscriptionId);
      }

      // Get the subscription first
      const { data: subscription, error: fetchError } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error("[v1/SubscriptionService/cancelSubscription] Fetch error:", fetchError);
        return {
          success: false,
          message: "Failed to fetch subscription",
          error: fetchError.message,
        };
      }

      if (!subscription) {
        return {
          success: false,
          message: "No active subscription found",
        };
      }

      // Update subscription status to EXPIRED (soft delete - no hard delete)
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("v1_subscriptions")
        .update({ status: "EXPIRED" })
        .eq("id", subscription.id)
        .select(`
          *,
          v1_plans(
            *
          )
        `)
        .single();

      if (updateError) {
        console.error("[v1/SubscriptionService/cancelSubscription] Update error:", updateError);
        return {
          success: false,
          message: "Failed to cancel subscription",
          error: updateError.message,
        };
      }

      // Transform the data to rename v1_plans to plan
      const { v1_plans, ...subscriptionData } = updated;
      const cancelledSubscription = {
        ...subscriptionData,
        plan: v1_plans || null,
      };

      return {
        success: true,
        subscription: cancelledSubscription,
        message: "Subscription cancelled successfully",
      };
    } catch (err) {
      console.error("[v1/SubscriptionService/cancelSubscription] Exception:", err);
      return {
        success: false,
        message: "Failed to cancel subscription",
        error: err.message,
      };
    }
  }
}

module.exports = new SubscriptionService();

