const { supabaseAdmin } = require('../db/config');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn('⚠️  RazorPay environment variables not set. Payout features will be limited.');
}

class PayoutService {
  /**
   * Normalize date value to ISO string
   */
  toISO(dateVal) {
    if (!dateVal) return null;
    try {
      return new Date(dateVal).toISOString();
    } catch (e) {
      return null;
    }
  }

  /**
   * Convert rupees to paise (for Razorpay API)
   */
  rupeesToPaise(rupees) {
    return Math.round(parseFloat(rupees) * 100);
  }

  /**
   * Convert paise to rupees (from Razorpay API responses)
   */
  paiseToRupees(paise) {
    return parseFloat((paise / 100).toFixed(2));
  }

  /**
   * Create Razorpay payment order for payout (Admin pays for payout)
   * Similar to application payments - admin creates order and pays via Razorpay checkout
   * @param {string} payoutId - Payout ID
   * @param {string} adminId - Admin user ID
   */
  async createPayoutPaymentOrder(payoutId, adminId) {
    try {
      if (!razorpay) {
        return {
          success: false,
          message: 'Payment service is not configured',
        };
      }

      // Get payout details
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('v1_payouts')
        .select(`
          *,
          v1_applications!inner(
            id,
            phase,
            influencer_id
          )
        `)
        .eq('id', payoutId)
        .maybeSingle();

      if (payoutError || !payout) {
        return {
          success: false,
          message: 'Payout not found',
        };
      }

      // Check if application is completed
      if (payout.v1_applications.phase !== 'COMPLETED') {
        return {
          success: false,
          message: 'Application must be completed before paying payout',
        };
      }

      // Check if payout is already released
      if (payout.status === 'RELEASED') {
        return {
          success: false,
          message: 'Payout already released',
        };
      }

      // Validate payout amount
      const amountRupees = payout.amount;
      if (!amountRupees || amountRupees <= 0) {
        return {
          success: false,
          message: 'Invalid payout amount',
        };
      }

      // Check if payment order already exists for this payout
      const { data: existingOrder } = await supabaseAdmin
        .from('v1_payment_orders')
        .select('id, status')
        .eq('metadata->>payout_id', payoutId)
        .maybeSingle();

      if (existingOrder) {
        const normalizedStatus = (existingOrder.status || '').toUpperCase();
        if (normalizedStatus === 'VERIFIED') {
          return {
            success: false,
            message: 'Payout payment already completed',
          };
        }
        return {
          success: false,
          message: 'Payout payment order already exists',
        };
      }

      // Convert to paise ONLY for Razorpay API (Razorpay requires amounts in paise)
      const amountInPaise = this.rupeesToPaise(amountRupees);

      // Razorpay receipt must be <= 40 chars
      const rawReceipt = `pout_${payoutId.substring(0, 20)}_${Date.now()}`;
      const safeReceipt = rawReceipt.substring(0, 40);

      // Create Razorpay order (amount in paise - Razorpay API requirement)
      const orderOptions = {
        amount: amountInPaise, // Razorpay API requires paise
        currency: 'INR',
        receipt: safeReceipt,
        notes: {
          payout_id: payoutId,
          influencer_id: payout.influencer_id,
          application_id: payout.application_id,
          payer_id: adminId,
          payment_type: 'payout_payment',
        },
      };

      const razorpayOrder = await razorpay.orders.create(orderOptions);

      // Store payment order in database (amount in RUPEES - not paise)
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from('v1_payment_orders')
        .insert({
          application_id: payout.application_id, // Can be null for payout payments
          amount: amountRupees, // Stored in RUPEES
          currency: 'INR',
          status: 'CREATED',
          razorpay_order_id: razorpayOrder.id,
          metadata: {
            payout_id: payoutId,
            influencer_id: payout.influencer_id,
            payer_id: adminId,
            payment_type: 'payout_payment',
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error('[PayoutService/createPayoutPaymentOrder] Database error:', orderError);
        return {
          success: false,
          message: 'Failed to create payout payment order',
          error: orderError.message,
        };
      }

      // Convert Razorpay order amounts from paise to rupees for response
      const orderInRupees = {
        ...razorpayOrder,
        amount: this.paiseToRupees(razorpayOrder.amount),
        amount_paid: razorpayOrder.amount_paid ? this.paiseToRupees(razorpayOrder.amount_paid) : 0,
        amount_due: razorpayOrder.amount_due ? this.paiseToRupees(razorpayOrder.amount_due) : 0,
      };

      return {
        success: true,
        order: orderInRupees,
        payment_order: {
          ...paymentOrder,
          created_at: this.toISO(paymentOrder.created_at),
          updated_at: this.toISO(paymentOrder.updated_at),
        },
        message: 'Payout payment order created successfully',
      };
    } catch (err) {
      console.error('[PayoutService/createPayoutPaymentOrder] Exception:', err);
      return {
        success: false,
        message: 'Failed to create payout payment order',
        error: err.message,
      };
    }
  }

  /**
   * Verify payout payment and mark payout as released
   * @param {Object} paymentData - Payment verification data
   * @param {string} adminId - Admin user ID
   */
  async verifyPayoutPayment(paymentData, adminId) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        payout_id,
      } = paymentData;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return {
          success: false,
          message: 'Missing required payment information',
        };
      }

      // Verify payment signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');

      if (razorpay_signature !== expectedSignature) {
        return {
          success: false,
          message: 'Invalid payment signature',
        };
      }

      // Get payment order
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from('v1_payment_orders')
        .select('*')
        .eq('razorpay_order_id', razorpay_order_id)
        .maybeSingle();

      if (orderError || !paymentOrder) {
        return {
          success: false,
          message: 'Payment order not found',
        };
      }

      // Check if it's a payout payment
      if (!paymentOrder.metadata || paymentOrder.metadata.payment_type !== 'payout_payment') {
        return {
          success: false,
          message: 'Invalid payment order type',
        };
      }

      // Normalize status
      const normalizedStatus = (paymentOrder.status || '').toUpperCase();

      // Check if payment already verified
      if (normalizedStatus === 'VERIFIED') {
        return {
          success: false,
          message: 'Payment already verified',
        };
      }

      // Check for duplicate payment
      const { data: existingPayment } = await supabaseAdmin
        .from('v1_payment_orders')
        .select('id')
        .eq('razorpay_payment_id', razorpay_payment_id)
        .maybeSingle();

      if (existingPayment && existingPayment.id !== paymentOrder.id) {
        return {
          success: false,
          message: 'Payment already processed',
        };
      }

      // Get payout_id from payment order metadata
      const orderPayoutId = paymentOrder.metadata.payout_id;

      // Validate payout_id matches if provided
      if (payout_id && payout_id !== orderPayoutId) {
        return {
          success: false,
          message: 'Payout ID mismatch with payment order',
        };
      }

      // Get payout details
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('v1_payouts')
        .select('*')
        .eq('id', orderPayoutId)
        .maybeSingle();

      if (payoutError || !payout) {
        return {
          success: false,
          message: 'Payout not found',
        };
      }

      // Check if payout is already released
      if (payout.status === 'RELEASED') {
        return {
          success: false,
          message: 'Payout already released',
        };
      }

      // Update payment order status
      const { error: updatePaymentError } = await supabaseAdmin
        .from('v1_payment_orders')
        .update({
          status: 'VERIFIED',
          razorpay_payment_id: razorpay_payment_id,
          razorpay_signature: razorpay_signature,
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentOrder.id);

      if (updatePaymentError) {
        console.error('[PayoutService/verifyPayoutPayment] Payment order update error:', updatePaymentError);
        return {
          success: false,
          message: 'Failed to update payment order',
          error: updatePaymentError.message,
        };
      }

      // Update payout status to RELEASED
      const { data: updatedPayout, error: payoutUpdateError } = await supabaseAdmin
        .from('v1_payouts')
        .update({
          status: 'RELEASED',
          released_by_admin_id: adminId,
          released_at: new Date().toISOString(),
        })
        .eq('id', payout.id)
        .select()
        .single();

      if (payoutUpdateError) {
        console.error('[PayoutService/verifyPayoutPayment] Payout update error:', payoutUpdateError);
        return {
          success: false,
          message: 'Payment verified but failed to update payout',
          error: payoutUpdateError.message,
        };
      }

      // Create transaction record (all amounts in RUPEES)
      try {
        await supabaseAdmin
          .from('v1_transactions')
          .insert({
            application_id: payout.application_id,
            type: 'INFLUENCER_PAYOUT',
            from_entity: adminId,
            to_entity: payout.influencer_id,
            gross_amount: payout.amount, // In RUPEES
            platform_fee: 0, // In RUPEES
            net_amount: payout.amount, // In RUPEES
            status: 'COMPLETED',
          });
      } catch (txnError) {
        console.error('[PayoutService/verifyPayoutPayment] Transaction creation error:', txnError);
        // Don't fail verification if transaction creation fails
      }

      return {
        success: true,
        message: 'Payout payment verified and released successfully',
        payout: {
          ...updatedPayout,
          created_at: this.toISO(updatedPayout.created_at),
          released_at: this.toISO(updatedPayout.released_at),
          updated_at: this.toISO(updatedPayout.updated_at),
        },
        payment_order: {
          ...paymentOrder,
          status: 'VERIFIED',
          razorpay_payment_id: razorpay_payment_id,
          created_at: this.toISO(paymentOrder.created_at),
          updated_at: this.toISO(new Date().toISOString()),
        },
      };
    } catch (err) {
      console.error('[PayoutService/verifyPayoutPayment] Exception:', err);
      return {
        success: false,
        message: 'Failed to verify payout payment',
        error: err.message,
      };
    }
  }

  /**
   * Get payout status
   * @param {string} payoutId - Payout ID
   */
  async getPayoutStatus(payoutId) {
    try {
      // Get payout from database
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('v1_payouts')
        .select(`
          *,
          v1_applications(
            id,
            phase,
            campaign_id,
            v1_campaigns(
              id,
              title,
              brand_id
            )
          )
        `)
        .eq('id', payoutId)
        .maybeSingle();

      if (payoutError) {
        console.error('[PayoutService/getPayoutStatus] Database error:', payoutError);
        return {
          success: false,
          message: 'Failed to fetch payout',
          error: payoutError.message,
        };
      }

      if (!payout) {
        return {
          success: false,
          message: 'Payout not found',
        };
      }

      // Fetch admin user data separately if payout has released_by_admin_id
      if (payout.released_by_admin_id) {
        const { data: adminUser, error: adminError } = await supabaseAdmin
          .from('v1_users')
          .select('id, name, email')
          .eq('id', payout.released_by_admin_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (adminError) {
          console.error('[PayoutService/getPayoutStatus] Admin user fetch error:', adminError);
        } else if (adminUser) {
          payout.v1_users = adminUser;
        }
      }

      // If payout is released and we have Razorpay payout ID, fetch status from Razorpay
      let razorpayStatus = null;
      if (payout.status === 'RELEASED' && razorpay) {
        // Note: You'll need to store razorpay_payout_id in v1_payouts table
        // For now, this is a placeholder
        // You can add a razorpay_payout_id column to v1_payouts table
        try {
          // This would require storing razorpay_payout_id when creating payout
          // const razorpayPayout = await razorpay.payouts.fetch(payout.razorpay_payout_id);
          // razorpayStatus = razorpayPayout;
        } catch (razorpayError) {
          console.error('[PayoutService/getPayoutStatus] Razorpay fetch error:', razorpayError);
        }
      }

      return {
        success: true,
        payout: {
          ...payout,
          created_at: this.toISO(payout.created_at),
          released_at: payout.released_at ? this.toISO(payout.released_at) : null,
          updated_at: payout.updated_at ? this.toISO(payout.updated_at) : null,
        },
        razorpay_status: razorpayStatus,
      };
    } catch (err) {
      console.error('[PayoutService/getPayoutStatus] Exception:', err);
      return {
        success: false,
        message: 'Failed to get payout status',
        error: err.message,
      };
    }
  }

  /**
   * Get all payouts for an application
   * @param {string} applicationId - Application ID
   */
  async getApplicationPayouts(applicationId) {
    try {
      const { data: payouts, error } = await supabaseAdmin
        .from('v1_payouts')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[PayoutService/getApplicationPayouts] Error:', error);
        return {
          success: false,
          message: 'Failed to fetch payouts',
          error: error.message,
        };
      }

      // Fetch admin user data separately if payouts have released_by_admin_id
      if (payouts && payouts.length > 0) {
        const adminIds = [...new Set(payouts.map(p => p.released_by_admin_id).filter(Boolean))];
        
        if (adminIds.length > 0) {
          const { data: admins, error: adminsError } = await supabaseAdmin
            .from('v1_users')
            .select('id, name, email')
            .in('id', adminIds)
            .eq('is_deleted', false);

          if (adminsError) {
            console.error('[PayoutService/getApplicationPayouts] Admins fetch error:', adminsError);
          } else if (admins) {
            // Create a map for quick lookup
            const adminMap = {};
            admins.forEach(admin => {
              adminMap[admin.id] = admin;
            });

            // Attach admin data to each payout
            payouts.forEach(payout => {
              payout.v1_users = payout.released_by_admin_id ? adminMap[payout.released_by_admin_id] || null : null;
            });
          }
        }
        
        // Format dates for all payouts
        payouts.forEach(payout => {
          payout.created_at = this.toISO(payout.created_at);
          payout.released_at = payout.released_at ? this.toISO(payout.released_at) : null;
          payout.updated_at = payout.updated_at ? this.toISO(payout.updated_at) : null;
        });
      }

      return {
        success: true,
        payouts: payouts || [],
      };
    } catch (err) {
      console.error('[PayoutService/getApplicationPayouts] Exception:', err);
      return {
        success: false,
        message: 'Failed to fetch payouts',
        error: err.message,
      };
    }
  }

  /**
   * Get all pending payouts (Admin only)
   */
  async getPendingPayouts() {
    try {
      const { data: payouts, error } = await supabaseAdmin
        .from('v1_payouts')
        .select(`
          *,
          v1_applications(
            id,
            phase,
            campaign_id,
            v1_campaigns(
              id,
              title
            )
          ),
          v1_influencer_profiles(
            user_id,
            profile_photo_url
          )
        `)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[PayoutService/getPendingPayouts] Error:', error);
        return {
          success: false,
          message: 'Failed to fetch pending payouts',
          error: error.message,
        };
      }

      // Fetch user data separately since influencer_id references v1_influencer_profiles, not v1_users directly
      if (payouts && payouts.length > 0) {
        const influencerIds = [...new Set(payouts.map(p => p.influencer_id).filter(Boolean))];
        
        if (influencerIds.length > 0) {
          const { data: users, error: usersError } = await supabaseAdmin
            .from('v1_users')
            .select('id, name, email')
            .in('id', influencerIds)
            .eq('is_deleted', false);

          if (usersError) {
            console.error('[PayoutService/getPendingPayouts] Users fetch error:', usersError);
          } else if (users) {
            // Create a map for quick lookup
            const userMap = {};
            users.forEach(user => {
              userMap[user.id] = user;
            });

            // Attach user data to each payout
            payouts.forEach(payout => {
              payout.v1_users = userMap[payout.influencer_id] || null;
            });
          }
        }
        
        // Format dates for all payouts
        payouts.forEach(payout => {
          payout.created_at = this.toISO(payout.created_at);
          payout.released_at = payout.released_at ? this.toISO(payout.released_at) : null;
          payout.updated_at = payout.updated_at ? this.toISO(payout.updated_at) : null;
        });
      }

      return {
        success: true,
        payouts: payouts || [],
      };
    } catch (err) {
      console.error('[PayoutService/getPendingPayouts] Exception:', err);
      return {
        success: false,
        message: 'Failed to fetch pending payouts',
        error: err.message,
      };
    }
  }
}

module.exports = new PayoutService();

