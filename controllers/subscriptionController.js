const { supabaseAdmin } = require('../supabase/client');
const Razorpay = require('razorpay');

// Initialize Razorpay only if environment variables are available
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
} else {
    console.warn('⚠️  RazorPay environment variables not set. Payment features will be disabled.');
}

class SubscriptionController {
    /**
     * Get all available subscription plans
     */
    async getPlans(req, res) {
        try {
            const { data: plans, error } = await supabaseAdmin
                .from('plans')
                .select('*')
                .eq('is_active', true)
                .order('price', { ascending: true });

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch plans'
                });
            }

            return res.json({
                success: true,
                plans: plans || []
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
            const { data, error } = await supabaseAdmin.rpc('get_user_subscription_status', {
                user_uuid: userId
            });

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch subscription status'
                });
            }

            return res.json({
                success: true,
                subscription: data
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Create RazorPay order for subscription
     */
    async createSubscriptionOrder(req, res) {
        try {
            const { plan_id } = req.body;
            const userId = req.user.id;

            if (!plan_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Plan ID is required'
                });
            }

            // Check if RazorPay is configured
            if (!razorpay) {
                return res.status(503).json({
                    success: false,
                    message: 'Payment service is not configured. Please contact support.'
                });
            }

            // Get plan details
            const { data: plan, error: planError } = await supabaseAdmin
                .from('plans')
                .select('*')
                .eq('id', plan_id)
                .eq('is_active', true)
                .single();

            if (planError || !plan) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid plan selected'
                });
            }

            // Create RazorPay order first
            const orderOptions = {
                amount: Math.round(plan.price * 100), // Convert to paise
                currency: 'INR',
                receipt: `sub_${Date.now()}`, // Shorter receipt format
                notes: {
                    user_id: userId,
                    plan_id: plan_id,
                    plan_name: plan.name
                }
            };

            const order = await razorpay.orders.create(orderOptions);

            // Calculate subscription dates for reference
            const startDate = new Date();
            const endDate = SubscriptionController.calculateEndDate(plan.period, startDate);

            // Check if user already has an active subscription
            const { data: existingActiveSubscription } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active')
                .single();

            if (existingActiveSubscription) {
                // User has active subscription - check if it's a different plan
                if (existingActiveSubscription.plan_id === plan_id) {
                    return res.status(400).json({
                        success: false,
                        message: 'You already have an active subscription for this plan'
                    });
                } else {
                    // Different plan selected - this will be an upgrade/downgrade
                    return res.json({
                        success: true,
                        order: {
                            id: order.id,
                            amount: order.amount,
                            currency: order.currency,
                            receipt: order.receipt
                        },
                        subscription_data: {
                            plan_id: plan_id,
                            start_date: startDate.toISOString(),
                            end_date: endDate.toISOString(),
                            amount_paid: plan.price
                        },
                        plan: plan,
                        existing_subscription: existingActiveSubscription,
                        is_upgrade: true
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
                    receipt: order.receipt
                },
                subscription_data: {
                    plan_id: plan_id,
                    start_date: startDate.toISOString(),
                    end_date: endDate.toISOString(),
                    amount_paid: plan.price
                },
                plan: plan
            });
        } catch (error) {
            console.error('Subscription order creation error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                amount_paid
            } = req.body;

            const userId = req.user.id;

            if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required payment information'
                });
            }

            // Check if RazorPay is configured
            if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
                return res.status(503).json({
                    success: false,
                    message: 'Payment service is not configured. Please contact support.'
                });
            }

            // Verify payment signature
            const text = `${razorpay_order_id}|${razorpay_payment_id}`;
            const crypto = require('crypto');
            const signature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(text)
                .digest('hex');

            if (signature !== razorpay_signature) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid payment signature'
                });
            }

            // Check if user already has an active subscription
            const { data: existingActiveSubscription } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active')
                .single();

            let subscription;
            let error;

            if (existingActiveSubscription) {
                // Update existing subscription (upgrade/downgrade)
                // Keep original start date, extend end date by new plan duration
                const originalStartDate = new Date(existingActiveSubscription.start_date);
                const currentEndDate = new Date(existingActiveSubscription.end_date);
                const now = new Date();
                
                // If current subscription hasn't expired, extend from current end date
                // If current subscription has expired, start from now
                const baseDate = currentEndDate > now ? currentEndDate : now;
                const newEndDate = SubscriptionController.calculateEndDate(plan.period, baseDate);
                
                const { data: updatedSubscription, error: updateError } = await supabaseAdmin
                    .from('subscriptions')
                    .update({
                        plan_id: plan_id,
                        start_date: existingActiveSubscription.start_date, // Keep original start date
                        end_date: newEndDate.toISOString(), // Extend end date
                        razorpay_payment_id: razorpay_payment_id,
                        amount_paid: amount_paid || 0,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingActiveSubscription.id)
                    .select()
                    .single();

                subscription = updatedSubscription;
                error = updateError;
            } else {
                // Create new active subscription record
                const { data: newSubscription, error: insertError } = await supabaseAdmin
                    .from('subscriptions')
                    .insert({
                        user_id: userId,
                        plan_id: plan_id,
                        status: 'active',
                        start_date: start_date || new Date().toISOString(),
                        end_date: end_date || SubscriptionController.calculateEndDate(plan_id, new Date()).toISOString(),
                        razorpay_payment_id: razorpay_payment_id,
                        amount_paid: amount_paid || 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                subscription = newSubscription;
                error = insertError;
            }

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create subscription record'
                });
            }

            return res.json({
                success: true,
                subscription: subscription,
                message: 'Payment processed successfully and subscription activated'
            });
        } catch (error) {
            console.error('Subscription payment processing error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                .from('subscriptions')
                .update({
                    status: 'cancelled',
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId)
                .eq('status', 'active')
                .select()
                .single();

            if (error || !subscription) {
                return res.status(400).json({
                    success: false,
                    message: 'No active subscription found'
                });
            }

            return res.json({
                success: true,
                subscription: subscription,
                message: 'Subscription cancelled successfully'
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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

            const { data: subscriptions, error, count } = await supabaseAdmin
                .from('subscriptions')
                .select(`
                    *,
                    plans (*)
                `, { count: 'exact' })
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + limitNum - 1);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch subscription history'
                });
            }

            return res.json({
                success: true,
                subscriptions: subscriptions || [],
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limitNum)
                }
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                    message: 'Plan ID is required'
                });
            }

            // Get plan details
            const { data: plan, error: planError } = await supabaseAdmin
                .from('plans')
                .select('*')
                .eq('id', plan_id)
                .eq('is_active', true)
                .single();

            if (planError || !plan) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid plan selected'
                });
            }

            // Check if user already has an active subscription
            const { data: existingActiveSubscription } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active')
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
                const newEndDate = SubscriptionController.calculateEndDate(plan.period, baseDate);

                const { data: updatedSubscription, error: updateError } = await supabaseAdmin
                    .from('subscriptions')
                    .update({
                        plan_id: plan_id,
                        start_date: existingActiveSubscription.start_date, // Keep original start date
                        end_date: newEndDate.toISOString(), // Extend end date
                        razorpay_payment_id: `test_payment_${Date.now()}`,
                        amount_paid: plan.price,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingActiveSubscription.id)
                    .select()
                    .single();

                subscription = updatedSubscription;
                error = updateError;
            } else {
                // Create new active subscription record
                const startDate = new Date();
                const endDate = SubscriptionController.calculateEndDate(plan.period, startDate);

                const { data: newSubscription, error: insertError } = await supabaseAdmin
                    .from('subscriptions')
                    .insert({
                        user_id: userId,
                        plan_id: plan_id,
                        status: 'active',
                        start_date: startDate.toISOString(),
                        end_date: endDate.toISOString(),
                        razorpay_payment_id: `test_payment_${Date.now()}`,
                        amount_paid: plan.price,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                subscription = newSubscription;
                error = insertError;
            }

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to process test payment'
                });
            }

            return res.json({
                success: true,
                subscription: subscription,
                message: existingActiveSubscription ? 'Subscription upgraded successfully' : 'Test subscription created successfully'
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                    message: 'Plan ID is required'
                });
            }

            // Get plan details
            const { data: plan, error: planError } = await supabaseAdmin
                .from('plans')
                .select('*')
                .eq('id', plan_id)
                .eq('is_active', true)
                .single();

            if (planError || !plan) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid plan selected'
                });
            }

            // Check if user already has an active subscription
            const { data: existingActiveSubscription } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active')
                .single();

            if (existingActiveSubscription) {
                return res.status(400).json({
                    success: false,
                    message: 'You already have an active subscription'
                });
            }

            // Create active subscription record for testing
            const startDate = new Date();
            const endDate = SubscriptionController.calculateEndDate(plan.period, startDate);

            const { data: subscription, error } = await supabaseAdmin
                .from('subscriptions')
                .insert({
                    user_id: userId,
                    plan_id: plan_id,
                    status: 'active',
                    start_date: startDate.toISOString(),
                    end_date: endDate.toISOString(),
                    razorpay_payment_id: 'test_payment_123',
                    amount_paid: plan.price,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create test subscription'
                });
            }

            return res.json({
                success: true,
                subscription: subscription,
                message: 'Test subscription created successfully'
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                    message: 'Payment service is not configured'
                });
            }

            return res.json({
                success: true,
                config: {
                    key_id: process.env.RAZORPAY_KEY_ID,
                    currency: 'INR'
                }
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Handle RazorPay webhook
     */
    async handleWebhook(req, res) {
        try {
            const { event, payload } = req.body;

            console.log(`Received webhook event: ${event}`, payload);

            // Verify webhook signature (optional for development)
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (webhookSecret) {
                const signature = req.headers['x-razorpay-signature'];
                const expectedSignature = require('crypto')
                    .createHmac('sha256', webhookSecret)
                    .update(JSON.stringify(req.body))
                    .digest('hex');

                if (signature !== expectedSignature) {
                    console.error('Invalid webhook signature');
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid webhook signature'
                    });
                }
            }

            // Handle different webhook events
            switch (event) {
                case 'payment.captured':
                    // Handle successful payment
                    console.log('Processing payment.captured event');
                    await SubscriptionController.handlePaymentSuccess(payload.payment.entity);
                    break;
                case 'subscription.activated':
                    // Handle subscription activation
                    console.log('Processing subscription.activated event');
                    await SubscriptionController.handleSubscriptionActivation(payload.subscription.entity);
                    break;
                case 'subscription.cancelled':
                    // Handle subscription cancellation
                    console.log('Processing subscription.cancelled event');
                    await SubscriptionController.handleSubscriptionCancellation(payload.subscription.entity);
                    break;
                default:
                    console.log(`Unhandled webhook event: ${event}`);
            }

            return res.json({ success: true });
        } catch (error) {
            console.error('Webhook error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
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
                    message: 'Payment ID is required'
                });
            }

            // Check if RazorPay is configured
            if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
                return res.status(503).json({
                    success: false,
                    message: 'Payment service is not configured'
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
                        created_at: payment.created_at
                    }
                });
            } catch (razorpayError) {
                if (razorpayError.error && razorpayError.error.description) {
                    return res.status(404).json({
                        success: false,
                        message: 'Payment not found',
                        error: razorpayError.error.description
                    });
                }
                
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch payment status'
                });
            }
        } catch (error) {
            console.error('Payment status check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update payment status manually (for frontend polling fallback)
     */
    async updatePaymentStatus(req, res) {
        try {
            const { order_id, payment_id, status, signature, plan_id, start_date, end_date, amount_paid } = req.body;
            const userId = req.user.id;

            if (!order_id || !payment_id || !status) {
                return res.status(400).json({
                    success: false,
                    message: 'Order ID, Payment ID, and Status are required'
                });
            }

            // If payment is successful, process it
            if (status === 'captured' || status === 'success') {
                if (!plan_id) {
                    return res.status(400).json({
                        success: false,
                        message: 'Plan ID is required for successful payments'
                    });
                }

                // Verify payment signature if provided
                if (signature && process.env.RAZORPAY_KEY_SECRET) {
                    const text = `${order_id}|${payment_id}`;
                    const crypto = require('crypto');
                    const expectedSignature = crypto
                        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                        .update(text)
                        .digest('hex');

                    if (signature !== expectedSignature) {
                        return res.status(400).json({
                            success: false,
                            message: 'Invalid payment signature'
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
                    payment_status: status
                });
            }
        } catch (error) {
            console.error('Update payment status error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Handle payment success
     */
    static async handlePaymentSuccess(payment) {
        try {
            console.log('Handling payment success for payment:', payment.id);
            
            // Get order details to find plan information
            const order = await razorpay.orders.fetch(payment.order_id);
            const planId = order.notes?.plan_id;
            
            if (!planId) {
                console.error('No plan_id found in order notes');
                return;
            }

            // Get plan details
            const { data: plan, error: planError } = await supabaseAdmin
                .from('plans')
                .select('*')
                .eq('id', planId)
                .eq('is_active', true)
                .single();

            if (planError || !plan) {
                console.error('Plan not found:', planId);
                return;
            }

            // Check if subscription already exists for this payment
            const { data: existingSubscription } = await supabaseAdmin
                .from('subscriptions')
                .select('*')
                .eq('razorpay_payment_id', payment.id)
                .single();

            if (existingSubscription) {
                console.log('Subscription already exists for payment:', payment.id);
                return;
            }

            // Find user by order notes or create a way to identify user
            // For now, we'll need to handle this differently since webhooks don't have user context
            console.log('Payment success processed, but user context needed for subscription creation');
            
            // Note: In a real implementation, you might want to:
            // 1. Store user_id in order notes during order creation
            // 2. Or use a separate table to map orders to users
            // 3. Or handle subscription creation in the frontend callback instead of webhook
            
        } catch (error) {
            console.error('Error handling payment success:', error);
        }
    }

    /**
     * Handle subscription activation
     */
    static async handleSubscriptionActivation(subscription) {
        try {
            // Update subscription status
            const { error } = await supabaseAdmin
                .from('subscriptions')
                .update({
                    status: 'active',
                    updated_at: new Date().toISOString()
                })
                .eq('razorpay_subscription_id', subscription.id);

            if (error) {
                console.error('Error updating subscription:', error);
            }
        } catch (error) {
            console.error('Error handling subscription activation:', error);
        }
    }

    /**
     * Handle subscription cancellation
     */
    static async handleSubscriptionCancellation(subscription) {
        try {
            // Update subscription status
            const { error } = await supabaseAdmin
                .from('subscriptions')
                .update({
                    status: 'cancelled',
                    updated_at: new Date().toISOString()
                })
                .eq('razorpay_subscription_id', subscription.id);

            if (error) {
                console.error('Error updating subscription:', error);
            }
        } catch (error) {
            console.error('Error handling subscription cancellation:', error);
        }
    }

    /**
     * Helper function to calculate end date based on plan period
     */
    static calculateEndDate(period, startDate) {
        const date = new Date(startDate);
        
        switch (period) {
            case '10 days':
                date.setDate(date.getDate() + 10);
                break;
            case '1 month':
                date.setMonth(date.getMonth() + 1);
                break;
            case '3 months':
                date.setMonth(date.getMonth() + 3);
                break;
            case '6 months':
                date.setMonth(date.getMonth() + 6);
                break;
            case '1 year':
                date.setFullYear(date.getFullYear() + 1);
                break;
            default:
                date.setMonth(date.getMonth() + 1); // Default to 1 month
        }
        
        return date;
    }
}

module.exports = {
    SubscriptionController: new SubscriptionController()
};
