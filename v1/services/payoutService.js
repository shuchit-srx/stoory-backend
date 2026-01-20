const { supabaseAdmin } = require('../db/config');
const Razorpay = require('razorpay');

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
   * Release payout to influencer using Razorpay (Admin only)
   * UPI ID is automatically fetched from v1_users table
   * @param {string} payoutId - Payout ID
   * @param {string} adminId - Admin user ID
   */
  async releasePayout(payoutId, adminId) {
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
            agreed_amount,
            platform_fee_amount,
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
          message: 'Application must be completed before releasing payout',
        };
      }

      // Check if payout is already released
      if (payout.status === 'RELEASED') {
        return {
          success: false,
          message: 'Payout already released',
        };
      }

      // Allow retrying failed payouts - just log a warning
      if (payout.status === 'FAILED') {
        console.warn('[PayoutService/releasePayout] Retrying payout that previously failed:', payoutId);
      }

      // Get influencer user details including UPI ID
      const { data: influencerUser, error: userError } = await supabaseAdmin
        .from('v1_users')
        .select('id, name, email, phone_number, upi_id')
        .eq('id', payout.influencer_id)
        .maybeSingle();

      if (userError) {
        console.error('[PayoutService/releasePayout] User fetch error:', userError);
        return {
          success: false,
          message: 'Failed to fetch influencer details',
          error: userError.message,
        };
      }

      if (!influencerUser) {
        return {
          success: false,
          message: 'Influencer not found',
        };
      }

      // Check if UPI ID exists
      if (!influencerUser.upi_id) {
        return {
          success: false,
          message: 'Influencer UPI ID not found. Please ask the influencer to add their UPI ID in their profile.',
        };
      }

      // Prepare Razorpay payout request using UPI via Fund Account
      const amountInPaise = this.rupeesToPaise(payout.amount);

      // Validate required env for payouts
      if (!process.env.RAZORPAY_ACCOUNT_NUMBER) {
        return {
          success: false,
          message: 'Payment service is not configured (missing RAZORPAY_ACCOUNT_NUMBER)',
        };
      }

      // Create Razorpay Contact (required for fund account)
      let contact;
      try {
        contact = await razorpay.contacts.create({
          name: influencerUser.name || 'Influencer',
          email: influencerUser.email || undefined,
          contact: influencerUser.phone_number || undefined,
          type: 'employee',
          reference_id: payout.influencer_id,
          notes: {
            influencer_id: payout.influencer_id,
            application_id: payout.application_id,
            payout_id: payout.id,
          },
        });
      } catch (razorpayError) {
        console.error('[PayoutService/releasePayout] Razorpay contact error:', razorpayError);
        return {
          success: false,
          message: razorpayError.error?.description || 'Failed to create Razorpay contact',
          error: razorpayError.error,
        };
      }

      // Create Razorpay Fund Account (VPA)
      let fundAccount;
      try {
        fundAccount = await razorpay.fundAccount.create({
          contact_id: contact.id,
          account_type: 'vpa',
          vpa: {
            address: influencerUser.upi_id,
          },
        });
      } catch (razorpayError) {
        console.error('[PayoutService/releasePayout] Razorpay fund account error:', razorpayError);
        const errorMessage = razorpayError.error?.description || razorpayError.message || 'Failed to create Razorpay fund account';
        return {
          success: false,
          message: errorMessage,
          error: razorpayError.error || razorpayError,
          contact_id: contact.id,
        };
      }

      const payoutRequest = {
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your Razorpay account number
        fund_account_id: fundAccount.id,
        amount: amountInPaise,
        currency: 'INR',
        mode: 'UPI', // UPI mode for instant payout
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: `payout_${payout.id}_${Date.now()}`,
        narration: `Payout for application ${payout.application_id}`,
        notes: {
          application_id: payout.application_id,
          influencer_id: payout.influencer_id,
          payout_id: payout.id,
          released_by: adminId,
        },
      };

      // Create Razorpay payout
      let razorpayPayout;
      try {
        razorpayPayout = await razorpay.payouts.create(payoutRequest);
      } catch (razorpayError) {
        console.error('[PayoutService/releasePayout] Razorpay payout creation error:', razorpayError);
        console.error('[PayoutService/releasePayout] Payout request:', JSON.stringify(payoutRequest, null, 2));
        
        // Update payout status to FAILED
        await supabaseAdmin
          .from('v1_payouts')
          .update({
            status: 'FAILED',
          })
          .eq('id', payoutId);

        // Return detailed error information
        const errorMessage = razorpayError.error?.description || razorpayError.message || 'Failed to create Razorpay payout';
        const errorDetails = razorpayError.error || razorpayError;

        return {
          success: false,
          message: errorMessage,
          error: errorDetails,
          details: {
            payout_request: payoutRequest,
            contact_id: contact?.id,
            fund_account_id: fundAccount?.id,
          },
        };
      }

      // Update payout in database
      const { data: updatedPayout, error: updateError } = await supabaseAdmin
        .from('v1_payouts')
        .update({
          status: 'RELEASED',
          released_by_admin_id: adminId,
          released_at: new Date().toISOString(),
        })
        .eq('id', payoutId)
        .select()
        .single();

      if (updateError) {
        console.error('[PayoutService/releasePayout] Update error:', updateError);
        return {
          success: false,
          message: 'Failed to update payout status',
          error: updateError.message,
        };
      }

      // Create transaction record
      try {
        // Get admin user ID
        const { data: adminUser } = await supabaseAdmin
          .from('v1_users')
          .select('id')
          .eq('id', adminId)
          .eq('role', 'ADMIN')
          .maybeSingle();

        const adminUserId = adminUser?.id || adminId;

        // Get application to find brand_id for transaction
        const { data: application } = await supabaseAdmin
          .from('v1_applications')
          .select(`
            id,
            campaign_id,
            v1_campaigns!inner(brand_id)
          `)
          .eq('id', payout.application_id)
          .maybeSingle();

        if (application) {
          await supabaseAdmin
            .from('v1_transactions')
            .insert({
              application_id: payout.application_id,
              type: 'INFLUENCER_PAYOUT',
              from_entity: adminUserId,
              to_entity: payout.influencer_id,
              gross_amount: payout.amount,
              platform_fee: 0, // No fee on payout
              net_amount: payout.amount,
              status: 'COMPLETED',
            });
        }
      } catch (txnError) {
        console.error('[PayoutService/releasePayout] Transaction creation error:', txnError);
        // Don't fail payout if transaction creation fails
      }

      return {
        success: true,
        message: 'Payout released successfully',
        payout: updatedPayout,
        razorpay_payout: {
          ...razorpayPayout,
          amount: this.paiseToRupees(razorpayPayout.amount),
        },
      };
    } catch (err) {
      console.error('[PayoutService/releasePayout] Exception:', err);
      return {
        success: false,
        message: 'Failed to release payout',
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
        payout: payout,
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

