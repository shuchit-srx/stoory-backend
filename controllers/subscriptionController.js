const { supabaseAdmin } = require("../supabase/client");
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
    "⚠️  RazorPay environment variables not set. Payment features will be disabled."
  );
}

class SubscriptionController {
  /**
   * Get all available subscription plans
   */
  async getPlans(req, res) {
    try {
      const { data: plans, error } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true });

      if (error) {
        console.error('Failed to fetch plans:', error.message || error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch plans",
          error: process.env.NODE_ENV === 'production' ? undefined : (error.message || String(error))
        });
      }

      return res.json({
        success: true,
        plans: plans || [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get user's current subscription status
   */
  async getSubscriptionStatus(req, res) {
    try {
      const userId = req.user.id;

      // Call the database function to get subscription status
      const { data, error } = await supabaseAdmin.rpc(
        "get_user_subscription_status",
        {
          user_uuid: userId,
        }
      );

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch subscription status",
        });
      }

      return res.json({
        success: true,
        subscription: data,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Create RazorPay order for subscription
   */
  async createSubscriptionOrder(req, res) {
    try {
      const { plan_id, coupon_code } = req.body;
      const userId = req.user.id;

      if (!plan_id) {
        return res.status(400).json({
          success: false,
          message: "Plan ID is required",
        });
      }

      // Check if RazorPay is configured
      if (!razorpay) {
        return res.status(503).json({
          success: false,
          message: "Payment service is not configured. Please contact support.",
        });
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", plan_id)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan selected",
        });
      }

      let finalAmount = plan.price;
      let couponData = null;
      let discountAmount = 0;

      // Validate coupon if provided (don't apply yet)
      if (coupon_code) {
        const { data: couponResult, error: couponError } = await supabaseAdmin.rpc("validate_coupon", {
          p_coupon_code: coupon_code,
          p_user_id: userId,
          p_order_amount: parseFloat(plan.price),
        });

        if (couponError || !couponResult || !couponResult.valid) {
          return res.status(400).json({
            success: false,
            message: couponResult?.error || "Invalid coupon code",
          });
        }

        // Calculate discount without applying the coupon
        couponData = {
          code: coupon_code,
          discount_amount: couponResult.discount_amount,
          final_amount: couponResult.final_amount,
          is_free: couponResult.final_amount === 0,
          applied: false  // Not applied yet
        };
        finalAmount = couponResult.final_amount;
        discountAmount = couponResult.discount_amount;
      }

      // Calculate subscription dates for reference
      const startDate = new Date();
      const endDate = SubscriptionController.calculateEndDate(
        plan.period,
        startDate
      );

      // Handle free subscriptions (amount = 0): create subscription immediately backend-side
      if (finalAmount === 0) {
        // Create subscription record immediately
        const { data: subscription, error: subError } = await supabaseAdmin
          .from("subscriptions")
          .insert({
            user_id: userId,
            plan_id: plan_id,
            status: "active",
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            amount_paid: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (subError) {
          return res.status(500).json({ success: false, message: "Failed to create subscription" });
        }

        // Apply coupon usage immediately for auditing
        if (coupon_code) {
          await supabaseAdmin.rpc("apply_coupon", {
            p_coupon_code: coupon_code,
            p_user_id: userId,
            p_order_amount: parseFloat(plan.price),
            p_subscription_id: subscription.id,
          });
        }

        return res.json({
          success: true,
          order: {
            id: `free_order_${Date.now()}`,
            amount: 0,
            currency: "INR",
            receipt: `free_rec_${Date.now().toString().slice(-8)}`,
          },
          subscription: subscription,
          subscription_data: {
            plan_id: plan_id,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            amount_paid: 0,
            original_amount: plan.price,
            discount_amount: discountAmount,
          },
          plan: plan,
          coupon: couponData,
          pricing: {
            original_price: plan.price,
            discount_amount: discountAmount,
            final_price: 0,
            savings: discountAmount
          },
          is_free: true
        });
      }

      // Create RazorPay order for paid subscriptions
      const orderOptions = {
        amount: Math.round(finalAmount * 100), // Convert to paise
        currency: "INR",
        receipt: `rec_${Date.now().toString().slice(-8)}_${Math.random()
          .toString(36)
          .substr(2, 3)}`, // Compliant with Razorpay 40-char limit
        notes: {
          user_id: userId,
          plan_id: plan_id,
          plan_name: plan.name,
          coupon_code: coupon_code || null,
          original_amount: plan.price,
          final_amount: finalAmount,
          discount_amount: discountAmount,
          coupon_applied: couponData ? JSON.stringify(couponData) : null,
        },
      };

      const order = await razorpay.orders.create(orderOptions);

      // Check if user already has an active subscription
      const { data: existingActiveSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      if (existingActiveSubscription) {
        // User has active subscription - check if it's a different plan
        if (existingActiveSubscription.plan_id === plan_id) {
          return res.status(400).json({
            success: false,
            message: "You already have an active subscription for this plan",
          });
        } else {
          // Different plan selected - this will be an upgrade/downgrade
          return res.json({
            success: true,
            order: {
              id: order.id,
              amount: order.amount,
              currency: order.currency,
              receipt: order.receipt,
            },
            subscription_data: {
              plan_id: plan_id,
              start_date: startDate.toISOString(),
              end_date: endDate.toISOString(),
              amount_paid: finalAmount,
              original_amount: plan.price,
              discount_amount: discountAmount,
            },
            plan: plan,
            existing_subscription: existingActiveSubscription,
            is_upgrade: true,
            coupon: couponData ? {
              code: coupon_code,
              discount_amount: discountAmount,
              final_amount: finalAmount,
              is_free: finalAmount === 0
            } : null,
            pricing: {
              original_price: plan.price,
              discount_amount: discountAmount,
              final_price: finalAmount,
              savings: discountAmount
            }
          });
        }
      }

      // No existing subscription - create new one
      return res.json({
        success: true,
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
        },
        subscription_data: {
          plan_id: plan_id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          amount_paid: finalAmount,
          original_amount: plan.price,
          discount_amount: discountAmount,
        },
        plan: plan,
        coupon: couponData ? {
          code: coupon_code,
          discount_amount: discountAmount,
          final_amount: finalAmount,
          is_free: finalAmount === 0
        } : null,
        pricing: {
          original_price: plan.price,
          discount_amount: discountAmount,
          final_price: finalAmount,
          savings: discountAmount
        }
      });
    } catch (error) {
      console.error("Subscription order creation error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Process subscription payment response
   */
  async processSubscriptionPayment(req, res) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        plan_id,
        start_date,
        end_date,
        amount_paid,
        coupon_code,
      } = req.body;

      const userId = req.user.id;

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature ||
        !plan_id
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required payment information",
        });
      }

      // Check if RazorPay is configured
      if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(503).json({
          success: false,
          message: "Payment service is not configured. Please contact support.",
        });
      }

      // Verify payment signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const crypto = require("crypto");
      const signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      if (signature !== razorpay_signature) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment signature",
        });
      }

      // Apply coupon if provided (only after successful payment verification)
      let couponData = null;
      if (coupon_code) {
        try {
          // Get order details to retrieve coupon data
          const order = await razorpay.orders.fetch(razorpay_order_id);
          const orderNotes = order.notes || {};
          
          // Apply the coupon now that payment is successful
          const { data: couponResult, error: couponError } = await supabaseAdmin.rpc("apply_coupon", {
            p_coupon_code: coupon_code,
            p_user_id: userId,
            p_order_amount: parseFloat(orderNotes.original_amount || amount_paid || 0),
            p_subscription_id: null,
          });

          if (couponError || !couponResult || !couponResult.valid) {
            console.error('Failed to apply coupon after payment:', couponResult?.error);
            // Continue without coupon data
            couponData = null;
          } else {
            couponData = {
              code: coupon_code,
              discount_amount: couponResult.discount_amount,
              final_amount: couponResult.final_amount,
              is_free: couponResult.final_amount === 0,
              applied: true
            };
          }
        } catch (error) {
          console.error('Error applying coupon after payment:', error);
          couponData = null;
        }
      }

      // Check if user already has an active subscription
      const { data: existingActiveSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      let subscription;
      let error;

      if (existingActiveSubscription) {
        // Update existing subscription (upgrade/downgrade)
        // Keep original start date, extend end date by new plan duration
        const originalStartDate = new Date(
          existingActiveSubscription.start_date
        );
        const currentEndDate = new Date(existingActiveSubscription.end_date);
        const now = new Date();

        // If current subscription hasn't expired, extend from current end date
        // If current subscription has expired, start from now
        const baseDate = currentEndDate > now ? currentEndDate : now;
        const newEndDate = SubscriptionController.calculateEndDate(
          plan.period,
          baseDate
        );

        const { data: updatedSubscription, error: updateError } =
          await supabaseAdmin
            .from("subscriptions")
            .update({
              plan_id: plan_id,
              start_date: existingActiveSubscription.start_date, // Keep original start date
              end_date: newEndDate.toISOString(), // Extend end date
              razorpay_payment_id: razorpay_payment_id,
              amount_paid: amount_paid || 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingActiveSubscription.id)
            .select()
            .single();

        subscription = updatedSubscription;
        error = updateError;
      } else {
        // Create new active subscription record
        const { data: newSubscription, error: insertError } =
          await supabaseAdmin
            .from("subscriptions")
            .insert({
              user_id: userId,
              plan_id: plan_id,
              status: "active",
              start_date: start_date || new Date().toISOString(),
              end_date:
                end_date ||
                SubscriptionController.calculateEndDate(
                  plan_id,
                  new Date()
                ).toISOString(),
              razorpay_payment_id: razorpay_payment_id,
              amount_paid: amount_paid || 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

        subscription = newSubscription;
        error = insertError;
      }

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create subscription record",
        });
      }

      return res.json({
        success: true,
        subscription: subscription,
        message: "Payment processed successfully and subscription activated",
        coupon: couponData ? {
          code: coupon_code,
          discount_amount: couponData.discount_amount,
          final_amount: couponData.final_amount,
          is_free: couponData.final_amount === 0
        } : null,
      });
    } catch (error) {
      console.error("Subscription payment processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Cancel active subscription
   */
  async cancelSubscription(req, res) {
    try {
      const userId = req.user.id;

      const { data: subscription, error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("status", "active")
        .select()
        .single();

      if (error || !subscription) {
        return res.status(400).json({
          success: false,
          message: "No active subscription found",
        });
      }

      return res.json({
        success: true,
        subscription: subscription,
        message: "Subscription cancelled successfully",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get subscription history
   */
  async getSubscriptionHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const {
        data: subscriptions,
        error,
        count,
      } = await supabaseAdmin
        .from("subscriptions")
        .select(
          `
                    *,
                    plans (*)
                `,
          { count: "exact" }
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch subscription history",
        });
      }

      return res.json({
        success: true,
        subscriptions: subscriptions || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          pages: Math.ceil((count || 0) / limitNum),
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
   * Test endpoint to process payment (for testing only)
   */
  async processTestPayment(req, res) {
    try {
      const userId = req.user.id;
      const { plan_id, order_id } = req.body;

      if (!plan_id) {
        return res.status(400).json({
          success: false,
          message: "Plan ID is required",
        });
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", plan_id)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan selected",
        });
      }

      // Check if user already has an active subscription
      const { data: existingActiveSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      let subscription;
      let error;

      if (existingActiveSubscription) {
        // Update existing subscription (upgrade/downgrade)
        // Keep original start date, extend end date by new plan duration
        const currentEndDate = new Date(existingActiveSubscription.end_date);
        const now = new Date();

        // If current subscription hasn't expired, extend from current end date
        // If current subscription has expired, start from now
        const baseDate = currentEndDate > now ? currentEndDate : now;
        const newEndDate = SubscriptionController.calculateEndDate(
          plan.period,
          baseDate
        );

        const { data: updatedSubscription, error: updateError } =
          await supabaseAdmin
            .from("subscriptions")
            .update({
              plan_id: plan_id,
              start_date: existingActiveSubscription.start_date, // Keep original start date
              end_date: newEndDate.toISOString(), // Extend end date
              razorpay_payment_id: `test_payment_${Date.now()}`,
              amount_paid: plan.price,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingActiveSubscription.id)
            .select()
            .single();

        subscription = updatedSubscription;
        error = updateError;
      } else {
        // Create new active subscription record
        const startDate = new Date();
        const endDate = SubscriptionController.calculateEndDate(
          plan.period,
          startDate
        );

        const { data: newSubscription, error: insertError } =
          await supabaseAdmin
            .from("subscriptions")
            .insert({
              user_id: userId,
              plan_id: plan_id,
              status: "active",
              start_date: startDate.toISOString(),
              end_date: endDate.toISOString(),
              razorpay_payment_id: `test_payment_${Date.now()}`,
              amount_paid: plan.price,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

        subscription = newSubscription;
        error = insertError;
      }

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to process test payment",
        });
      }

      return res.json({
        success: true,
        subscription: subscription,
        message: existingActiveSubscription
          ? "Subscription upgraded successfully"
          : "Test subscription created successfully",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Test endpoint to create subscription (for testing only)
   */
  async createTestSubscription(req, res) {
    try {
      const userId = req.user.id;
      const { plan_id } = req.body;

      if (!plan_id) {
        return res.status(400).json({
          success: false,
          message: "Plan ID is required",
        });
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", plan_id)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan selected",
        });
      }

      // Check if user already has an active subscription
      const { data: existingActiveSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      if (existingActiveSubscription) {
        return res.status(400).json({
          success: false,
          message: "You already have an active subscription",
        });
      }

      // Create active subscription record for testing
      const startDate = new Date();
      const endDate = SubscriptionController.calculateEndDate(
        plan.period,
        startDate
      );

      const { data: subscription, error } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan_id: plan_id,
          status: "active",
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          razorpay_payment_id: "test_payment_123",
          amount_paid: plan.price,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create test subscription",
        });
      }

      return res.json({
        success: true,
        subscription: subscription,
        message: "Test subscription created successfully",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Create free subscription with coupon
   */
  async createFreeSubscription(req, res) {
    try {
      const { plan_id, coupon_code } = req.body;
      const userId = req.user.id;

      if (!plan_id || !coupon_code) {
        return res.status(400).json({
          success: false,
          message: "Plan ID and coupon code are required",
        });
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", plan_id)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan selected",
        });
      }

      // Apply coupon
      const { data: couponResult, error: couponError } = await supabaseAdmin.rpc("apply_coupon", {
        p_coupon_code: coupon_code,
        p_user_id: userId,
        p_order_amount: parseFloat(plan.price),
        p_subscription_id: null,
      });

      if (couponError || !couponResult || !couponResult.valid) {
        return res.status(400).json({
          success: false,
          message: couponResult?.error || "Invalid coupon code",
        });
      }

      // Check if user already has an active subscription
      const { data: existingActiveSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      if (existingActiveSubscription) {
        return res.status(400).json({
          success: false,
          message: "You already have an active subscription",
        });
      }

      // Create free subscription
      const startDate = new Date();
      const endDate = SubscriptionController.calculateEndDate(plan.period, startDate);

      const { data: subscription, error } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan_id: plan_id,
          status: "active",
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          razorpay_payment_id: "free_subscription",
          amount_paid: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create free subscription",
        });
      }

      return res.json({
        success: true,
        subscription: subscription,
        message: "Free subscription activated successfully",
        coupon: {
          code: coupon_code,
          discount_amount: couponResult.discount_amount,
          final_amount: couponResult.final_amount,
          is_free: true
        },
      });
    } catch (error) {
      console.error("Free subscription creation error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get payment configuration
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
   * Handle RazorPay webhook
   */
  async handleWebhook(req, res) {
    try {
      const { event, payload } = req.body;

      console.log(`🔔 [WEBHOOK] Received event: ${event}`, payload);

      // Verify webhook signature (optional for development)
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers["x-razorpay-signature"];
        const expectedSignature = require("crypto")
          .createHmac("sha256", webhookSecret)
          .update(JSON.stringify(req.body))
          .digest("hex");

        if (signature !== expectedSignature) {
          console.error("❌ [WEBHOOK] Invalid webhook signature");
          return res.status(400).json({
            success: false,
            message: "Invalid webhook signature",
          });
        }
      }

      // Handle different webhook events
      switch (event) {
        case "payment.captured":
          // Handle successful payment - check if it's subscription or bid/campaign
          console.log("🔔 [WEBHOOK] Processing payment.captured event");
          await this.handlePaymentCaptured(payload.payment.entity);
          break;
        case "subscription.activated":
          // Handle subscription activation
          console.log("🔔 [WEBHOOK] Processing subscription.activated event");
          await SubscriptionController.handleSubscriptionActivation(
            payload.subscription.entity
          );
          break;
        case "subscription.cancelled":
          // Handle subscription cancellation
          console.log("🔔 [WEBHOOK] Processing subscription.cancelled event");
          await SubscriptionController.handleSubscriptionCancellation(
            payload.subscription.entity
          );
          break;
        default:
          console.log(`🔔 [WEBHOOK] Unhandled event: ${event}`);
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("❌ [WEBHOOK] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle payment.captured webhook - determine if it's subscription or bid/campaign payment
   */
  async handlePaymentCaptured(payment) {
    try {
      console.log("🔔 [WEBHOOK] Payment captured:", {
        id: payment.id,
        order_id: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      });

      // Check if this is a subscription payment by looking for subscription in notes
      if (payment.notes && payment.notes.subscription_id) {
        console.log("🔔 [WEBHOOK] Processing subscription payment");
        await SubscriptionController.handlePaymentSuccess(payment);
        return;
      }

      // Check if this is a bid/campaign payment by looking for conversation_id in notes
      if (payment.notes && payment.notes.conversation_id) {
        console.log("🔔 [WEBHOOK] Processing bid/campaign payment");
        await this.handleBidCampaignPayment(payment);
        return;
      }

      // Check if this is a bid/campaign payment by looking up the order
      console.log("🔔 [WEBHOOK] Checking payment order for conversation...");
      await this.handleBidCampaignPaymentByOrder(payment);

    } catch (error) {
      console.error("❌ [WEBHOOK] Error handling payment captured:", error);
    }
  }

  /**
   * Handle bid/campaign payment by conversation_id in notes
   */
  async handleBidCampaignPayment(payment) {
    try {
      const conversationId = payment.notes.conversation_id;
      console.log("🔔 [WEBHOOK] Processing payment for conversation:", conversationId);

      // Check if payment already processed
      const { supabaseAdmin } = require('../supabase/client');
      const { data: existingTransaction } = await supabaseAdmin
        .from("transactions")
        .select("id")
        .eq("razorpay_payment_id", payment.id)
        .single();

      if (existingTransaction) {
        console.log("🔔 [WEBHOOK] Payment already processed, skipping");
        return;
      }

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        console.error("❌ [WEBHOOK] Conversation not found:", conversationId);
        return;
      }

      // Process the payment using the same logic as verification endpoint
      await this.processWebhookPayment(conversation, payment);

    } catch (error) {
      console.error("❌ [WEBHOOK] Error handling bid/campaign payment:", error);
    }
  }

  /**
   * Handle bid/campaign payment by looking up the order
   */
  async handleBidCampaignPaymentByOrder(payment) {
    try {
      const { supabaseAdmin } = require('../supabase/client');
      
      // Look up payment order by razorpay_order_id
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("payment_orders")
        .select("*")
        .eq("razorpay_order_id", payment.order_id)
        .single();

      if (orderError || !paymentOrder) {
        console.log("🔔 [WEBHOOK] No payment order found for order:", payment.order_id);
        return;
      }

      // Check if payment already processed
      const { data: existingTransaction } = await supabaseAdmin
        .from("transactions")
        .select("id")
        .eq("razorpay_payment_id", payment.id)
        .single();

      if (existingTransaction) {
        console.log("🔔 [WEBHOOK] Payment already processed, skipping");
        return;
      }

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", paymentOrder.conversation_id)
        .single();

      if (convError || !conversation) {
        console.error("❌ [WEBHOOK] Conversation not found:", paymentOrder.conversation_id);
        return;
      }

      console.log("🔔 [WEBHOOK] Found conversation via payment order:", conversation.id);
      
      // Process the payment using the same logic as verification endpoint
      await this.processWebhookPayment(conversation, payment, paymentOrder);

    } catch (error) {
      console.error("❌ [WEBHOOK] Error handling payment by order:", error);
    }
  }

  /**
   * Process webhook payment using the same logic as verification endpoint
   */
  async processWebhookPayment(conversation, payment, paymentOrder = null) {
    try {
      console.log("🔔 [WEBHOOK] Processing payment for conversation:", conversation.id);

      const { supabaseAdmin } = require('../supabase/client');
      const enhancedBalanceService = require('../utils/enhancedBalanceService');

      // Get payment amount
      const paymentAmount = payment.amount; // Razorpay amount is already in paise
      console.log("🔔 [WEBHOOK] Payment amount (paise):", paymentAmount);

      // Add funds to influencer's wallet
      const addFundsResult = await enhancedBalanceService.addFunds(
        conversation.influencer_id,
        paymentAmount,
        {
          conversation_id: conversation.id,
          razorpay_order_id: payment.order_id,
          razorpay_payment_id: payment.id,
          conversation_type: conversation.campaign_id ? "campaign" : "bid",
          brand_owner_id: conversation.brand_owner_id,
          notes: `Payment received via webhook for ${conversation.campaign_id ? 'campaign' : 'bid'} collaboration`,
          source: 'webhook'
        }
      );

      if (!addFundsResult.success) {
        console.error("❌ [WEBHOOK] Failed to add funds:", addFundsResult.error);
        return;
      }

      console.log("✅ [WEBHOOK] Funds added successfully");

      // Update or create payment order
      if (paymentOrder) {
        const { error: updateOrderError } = await supabaseAdmin
          .from("payment_orders")
          .update({
            status: "verified",
            razorpay_payment_id: payment.id,
            razorpay_signature: payment.notes?.signature || null,
            verified_at: new Date().toISOString()
          })
          .eq("id", paymentOrder.id);

        if (updateOrderError) {
          console.error("❌ [WEBHOOK] Failed to update payment order:", updateOrderError);
        }
      } else {
        // Create new payment order
        const { data: newOrder, error: createOrderError } = await supabaseAdmin
          .from("payment_orders")
          .insert({
            conversation_id: conversation.id,
            amount_paise: paymentAmount,
            currency: payment.currency,
            status: "verified",
            razorpay_order_id: payment.order_id,
            razorpay_payment_id: payment.id,
            verified_at: new Date().toISOString(),
            metadata: {
              conversation_type: conversation.campaign_id ? "campaign" : "bid",
              brand_owner_id: conversation.brand_owner_id,
              influencer_id: conversation.influencer_id,
              source: 'webhook'
            }
          })
          .select()
          .single();

        if (createOrderError) {
          console.error("❌ [WEBHOOK] Failed to create payment order:", createOrderError);
        } else {
          paymentOrder = newOrder;
        }
      }

      // Create escrow hold if needed
      if (paymentOrder) {
        const { data: escrowHold, error: escrowError } = await supabaseAdmin
          .from('escrow_holds')
          .insert({
            conversation_id: conversation.id,
            payment_order_id: paymentOrder.id,
            amount_paise: paymentAmount,
            status: 'held',
            release_reason: 'Payment held in escrow until work completion',
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (escrowError) {
          console.error("❌ [WEBHOOK] Escrow hold creation error:", escrowError);
        } else {
          console.log("✅ [WEBHOOK] Escrow hold created:", escrowHold.id);
        }
      }

      // Update conversation state
      const { error: conversationUpdateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "payment_completed",
          awaiting_role: "influencer",
          chat_status: "real_time",
          payment_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", conversation.id);

      if (conversationUpdateError) {
        console.error("❌ [WEBHOOK] Failed to update conversation:", conversationUpdateError);
      } else {
        console.log("✅ [WEBHOOK] Conversation updated to payment_completed");
      }

      // Send notifications
      const io = require('../index').io;
      if (io) {
        // Emit payment completion events
        io.to(`conversation_${conversation.id}`).emit("payment_status_update", {
          conversation_id: conversation.id,
          status: "completed",
          message: "Payment has been successfully processed via webhook",
          chat_status: "real_time"
        });

        // Notify both users
        io.to(`user_${conversation.brand_owner_id}`).emit("notification", {
          type: "payment_completed",
          data: {
            conversation_id: conversation.id,
            message: "Payment completed successfully",
            chat_status: "real_time"
          }
        });

        io.to(`user_${conversation.influencer_id}`).emit("notification", {
          type: "payment_completed",
          data: {
            conversation_id: conversation.id,
            message: "Payment completed successfully",
            chat_status: "real_time"
          }
        });
      }

      console.log("✅ [WEBHOOK] Payment processing completed successfully");

    } catch (error) {
      console.error("❌ [WEBHOOK] Error processing webhook payment:", error);
    }
  }

  /**
   * Check for unprocessed payments (fallback mechanism)
   * This can be called periodically to catch any missed payments
   */
  async checkUnprocessedPayments(req, res) {
    try {
      console.log("🔍 [FALLBACK] Checking for unprocessed payments...");
      
      const { supabaseAdmin } = require('../supabase/client');
      
      // Get payment orders that are created but not verified
      const { data: unprocessedOrders, error: ordersError } = await supabaseAdmin
        .from("payment_orders")
        .select("*")
        .eq("status", "created")
        .not("razorpay_order_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (ordersError) {
        console.error("❌ [FALLBACK] Error fetching unprocessed orders:", ordersError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch unprocessed orders"
        });
      }

      if (!unprocessedOrders || unprocessedOrders.length === 0) {
        console.log("✅ [FALLBACK] No unprocessed payments found");
        return res.json({
          success: true,
          message: "No unprocessed payments found",
          count: 0
        });
      }

      console.log(`🔍 [FALLBACK] Found ${unprocessedOrders.length} unprocessed orders`);

      const results = {
        processed: 0,
        errors: 0,
        details: []
      };

      // Check each order with Razorpay
      const Razorpay = require('razorpay');
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      for (const order of unprocessedOrders) {
        try {
          // Get order details from Razorpay
          const razorpayOrder = await razorpay.orders.fetch(order.razorpay_order_id);
          
          if (razorpayOrder.status === 'paid') {
            console.log(`🔍 [FALLBACK] Order ${order.razorpay_order_id} is paid, processing...`);
            
            // Get conversation details
            const { data: conversation, error: convError } = await supabaseAdmin
              .from("conversations")
              .select("*")
              .eq("id", order.conversation_id)
              .single();

            if (convError || !conversation) {
              console.error(`❌ [FALLBACK] Conversation not found for order ${order.id}`);
              results.errors++;
              continue;
            }

            // Get payment details
            const payments = razorpayOrder.payments;
            if (payments && payments.length > 0) {
              const payment = payments[0]; // Get the first (and usually only) payment
              
              // Check if already processed
              const { data: existingTransaction } = await supabaseAdmin
                .from("transactions")
                .select("id")
                .eq("razorpay_payment_id", payment.id)
                .single();

              if (existingTransaction) {
                console.log(`🔍 [FALLBACK] Payment ${payment.id} already processed, skipping`);
                continue;
              }

              // Process the payment
              await this.processWebhookPayment(conversation, payment, order);
              results.processed++;
              results.details.push({
                order_id: order.id,
                razorpay_order_id: order.razorpay_order_id,
                payment_id: payment.id,
                status: 'processed'
              });
            }
          } else {
            console.log(`🔍 [FALLBACK] Order ${order.razorpay_order_id} status: ${razorpayOrder.status}`);
          }
        } catch (error) {
          console.error(`❌ [FALLBACK] Error processing order ${order.id}:`, error);
          results.errors++;
          results.details.push({
            order_id: order.id,
            razorpay_order_id: order.razorpay_order_id,
            status: 'error',
            error: error.message
          });
        }
      }

      console.log(`✅ [FALLBACK] Processed ${results.processed} payments, ${results.errors} errors`);

      return res.json({
        success: true,
        message: `Processed ${results.processed} payments, ${results.errors} errors`,
        results
      });

    } catch (error) {
      console.error("❌ [FALLBACK] Error checking unprocessed payments:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(req, res) {
    try {
      const { payment_id } = req.params;

      if (!payment_id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      // Check if RazorPay is configured
      if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(503).json({
          success: false,
          message: "Payment service is not configured",
        });
      }

      try {
        // Fetch payment details from RazorPay
        const payment = await razorpay.payments.fetch(payment_id);

        return res.json({
          success: true,
          payment: {
            id: payment.id,
            order_id: payment.order_id,
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            created_at: payment.created_at,
          },
        });
      } catch (razorpayError) {
        if (razorpayError.error && razorpayError.error.description) {
          return res.status(404).json({
            success: false,
            message: "Payment not found",
            error: razorpayError.error.description,
          });
        }

        return res.status(500).json({
          success: false,
          message: "Failed to fetch payment status",
        });
      }
    } catch (error) {
      console.error("Payment status check error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Admin: List all plans (active and inactive)
   */
  async adminListPlans(req, res) {
    try {
      const { data: plans, error } = await supabaseAdmin
        .from("plans")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch plans" });
      }

      return res.json({ success: true, plans: plans || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  /**
   * Admin: Create a new plan
   */
  async adminCreatePlan(req, res) {
    try {
      const {
        name,
        description,
        price,
        currency = 'INR',
        duration_months,
        features = [],
        is_active = true
      } = req.body;

      if (!name || price === undefined || duration_months === undefined) {
        return res.status(400).json({ success: false, message: "name, price, duration_months are required" });
      }

      const { data: plan, error } = await supabaseAdmin
        .from('plans')
        .insert({
          name,
          description: description || null,
          price: parseFloat(price),
          currency,
          duration_months: parseInt(duration_months),
          features: Array.isArray(features) ? features : [],
          is_active: Boolean(is_active),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ success: false, message: "Failed to create plan" });
      }

      return res.status(201).json({ success: true, plan });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  /**
   * Admin: Update an existing plan
   */
  async adminUpdatePlan(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        price,
        currency,
        duration_months,
        features,
        is_active
      } = req.body;

      const update = {
        name,
        description,
        price: price !== undefined ? parseFloat(price) : undefined,
        currency,
        duration_months: duration_months !== undefined ? parseInt(duration_months) : undefined,
        features: Array.isArray(features) ? features : undefined,
        is_active: is_active !== undefined ? Boolean(is_active) : undefined,
        updated_at: new Date().toISOString()
      };
      Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

      const { data: plan, error } = await supabaseAdmin
        .from('plans')
        .update(update)
        .eq('id', id)
        .select('*')
        .single();

      if (error || !plan) {
        return res.status(404).json({ success: false, message: "Plan not found or update failed" });
      }

      return res.json({ success: true, plan });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  /**
   * Admin: Delete a plan
   */
  async adminDeletePlan(req, res) {
    try {
      const { id } = req.params;

      const { error } = await supabaseAdmin
        .from('plans')
        .delete()
        .eq('id', id);

      if (error) {
        return res.status(500).json({ success: false, message: "Failed to delete plan" });
      }

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  /**
   * Update payment status manually (for frontend polling fallback)
   */
  async updatePaymentStatus(req, res) {
    try {
      const {
        order_id,
        payment_id,
        status,
        signature,
        plan_id,
        start_date,
        end_date,
        amount_paid,
      } = req.body;
      const userId = req.user.id;

      if (!order_id || !payment_id || !status) {
        return res.status(400).json({
          success: false,
          message: "Order ID, Payment ID, and Status are required",
        });
      }

      // If payment is successful, process it
      if (status === "captured" || status === "success") {
        if (!plan_id) {
          return res.status(400).json({
            success: false,
            message: "Plan ID is required for successful payments",
          });
        }

        // Verify payment signature if provided
        if (signature && process.env.RAZORPAY_KEY_SECRET) {
          const text = `${order_id}|${payment_id}`;
          const crypto = require("crypto");
          const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(text)
            .digest("hex");

          if (signature !== expectedSignature) {
            return res.status(400).json({
              success: false,
              message: "Invalid payment signature",
            });
          }
        }

        // Process the successful payment
        return await this.processSubscriptionPayment(req, res);
      } else {
        // Payment failed or pending
        return res.json({
          success: true,
          message: `Payment status updated to ${status}`,
          payment_status: status,
        });
      }
    } catch (error) {
      console.error("Update payment status error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle payment success
   */
  static async handlePaymentSuccess(payment) {
    try {
      console.log("Handling payment success for payment:", payment.id);

      // Get order details to find plan information
      const order = await razorpay.orders.fetch(payment.order_id);
      const planId = order.notes?.plan_id;

      if (!planId) {
        console.error("No plan_id found in order notes");
        return;
      }

      // Get plan details
      const { data: plan, error: planError } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", planId)
        .eq("is_active", true)
        .single();

      if (planError || !plan) {
        console.error("Plan not found:", planId);
        return;
      }

      // Check if subscription already exists for this payment
      const { data: existingSubscription } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("razorpay_payment_id", payment.id)
        .single();

      if (existingSubscription) {
        console.log("Subscription already exists for payment:", payment.id);
        return;
      }

      // Find user by order notes or create a way to identify user
      // For now, we'll need to handle this differently since webhooks don't have user context
      console.log(
        "Payment success processed, but user context needed for subscription creation"
      );

      // Note: In a real implementation, you might want to:
      // 1. Store user_id in order notes during order creation
      // 2. Or use a separate table to map orders to users
      // 3. Or handle subscription creation in the frontend callback instead of webhook
    } catch (error) {
      console.error("Error handling payment success:", error);
    }
  }

  /**
   * Handle subscription activation
   */
  static async handleSubscriptionActivation(subscription) {
    try {
      // Update subscription status
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", subscription.id);

      if (error) {
        console.error("Error updating subscription:", error);
      }
    } catch (error) {
      console.error("Error handling subscription activation:", error);
    }
  }

  /**
   * Handle subscription cancellation
   */
  static async handleSubscriptionCancellation(subscription) {
    try {
      // Update subscription status
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", subscription.id);

      if (error) {
        console.error("Error updating subscription:", error);
      }
    } catch (error) {
      console.error("Error handling subscription cancellation:", error);
    }
  }

  /**
   * Helper function to calculate end date based on plan period
   */
  static calculateEndDate(period, startDate) {
    const date = new Date(startDate);

    switch (period) {
      case "10 days":
        date.setDate(date.getDate() + 10);
        break;
      case "1 month":
        date.setMonth(date.getMonth() + 1);
        break;
      case "3 months":
        date.setMonth(date.getMonth() + 3);
        break;
      case "6 months":
        date.setMonth(date.getMonth() + 6);
        break;
      case "1 year":
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        date.setMonth(date.getMonth() + 1); // Default to 1 month
    }

    return date;
  }
}

module.exports = {
  SubscriptionController: new SubscriptionController(),
};
