const { supabaseAdmin } = require("../db/config");

/**
 * Plan Service
 * Handles business logic for plan operations
 */
class PlanService {
  /**
   * Create a new plan
   */
  async createPlan(planData) {
    try {
      // Validate billing cycle
      const billingCycle = planData.billing_cycle?.toUpperCase();
      if (!billingCycle || !["MONTHLY", "YEARLY"].includes(billingCycle)) {
        return {
          success: false,
          message: "billing_cycle must be MONTHLY or YEARLY",
        };
      }

      // Validate price
      const price = parseFloat(planData.price);
      if (isNaN(price) || price < 0) {
        return {
          success: false,
          message: "price must be a non-negative number",
        };
      }

      // Validate name
      if (!planData.name || typeof planData.name !== "string" || planData.name.trim().length === 0) {
        return {
          success: false,
          message: "name is required and must be a non-empty string",
        };
      }

      // Validate features (should be an object, defaults to empty object)
      let features = planData.features || {};
      if (typeof features !== "object" || Array.isArray(features)) {
        features = {};
      }

      // Build plan object
      const plan = {
        name: planData.name.trim(),
        features: features,
        price: price,
        billing_cycle: billingCycle,
        is_active: planData.is_active !== undefined ? Boolean(planData.is_active) : true,
      };

      // Insert plan
      const { data, error } = await supabaseAdmin
        .from("v1_plans")
        .insert(plan)
        .select()
        .single();

      if (error) {
        console.error("[v1/PlanService/createPlan] Database error:", error);
        return {
          success: false,
          message: "Failed to create plan",
          error: error.message,
        };
      }

      return {
        success: true,
        plan: data,
        message: "Plan created successfully",
      };
    } catch (err) {
      console.error("[v1/PlanService/createPlan] Exception:", err);
      return {
        success: false,
        message: "Failed to create plan",
        error: err.message,
      };
    }
  }

  /**
   * Get all active plans
   */
  async getAllPlans() {
    try {
      const { data, error } = await supabaseAdmin
        .from("v1_plans")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[v1/PlanService/getAllPlans] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch plans",
          error: error.message,
        };
      }

      return {
        success: true,
        plans: data || [],
        message: "Plans fetched successfully",
      };
    } catch (err) {
      console.error("[v1/PlanService/getAllPlans] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch plans",
        error: err.message,
      };
    }
  }

  /**
   * Update a plan by ID
   */
  async updatePlan(planId, updateData) {
    try {
      // Check if plan exists
      const { data: existingPlan, error: fetchError } = await supabaseAdmin
        .from("v1_plans")
        .select("*")
        .eq("id", planId)
        .single();

      if (fetchError || !existingPlan) {
        return {
          success: false,
          message: "Plan not found",
        };
      }

      // Build update object (only include provided fields)
      const update = {};

      if (updateData.name !== undefined) {
        if (typeof updateData.name !== "string" || updateData.name.trim().length === 0) {
          return {
            success: false,
            message: "name must be a non-empty string",
          };
        }
        update.name = updateData.name.trim();
      }

      if (updateData.features !== undefined) {
        if (typeof updateData.features !== "object" || Array.isArray(updateData.features)) {
          return {
            success: false,
            message: "features must be an object",
          };
        }
        update.features = updateData.features;
      }

      if (updateData.price !== undefined) {
        const price = parseFloat(updateData.price);
        if (isNaN(price) || price < 0) {
          return {
            success: false,
            message: "price must be a non-negative number",
          };
        }
        update.price = price;
      }

      if (updateData.billing_cycle !== undefined) {
        const billingCycle = updateData.billing_cycle.toUpperCase();
        if (!["MONTHLY", "YEARLY"].includes(billingCycle)) {
          return {
            success: false,
            message: "billing_cycle must be MONTHLY or YEARLY",
          };
        }
        update.billing_cycle = billingCycle;
      }

      if (updateData.is_active !== undefined) {
        update.is_active = Boolean(updateData.is_active);
      }

      // Check if there's anything to update
      if (Object.keys(update).length === 0) {
        return {
          success: false,
          message: "No valid fields provided for update",
        };
      }

      // Update plan
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("v1_plans")
        .update(update)
        .eq("id", planId)
        .select()
        .single();

      if (updateError) {
        console.error("[v1/PlanService/updatePlan] Database error:", updateError);
        return {
          success: false,
          message: "Failed to update plan",
          error: updateError.message,
        };
      }

      return {
        success: true,
        plan: updated,
        message: "Plan updated successfully",
      };
    } catch (err) {
      console.error("[v1/PlanService/updatePlan] Exception:", err);
      return {
        success: false,
        message: "Failed to update plan",
        error: err.message,
      };
    }
  }
}

module.exports = new PlanService();

