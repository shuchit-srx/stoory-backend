const { supabaseAdmin } = require("../supabase/client");
const adminPaymentFlowService = require("../utils/adminPaymentFlowService");

class AdminPaymentController {
  /**
   * Trigger expiry sweep for campaigns and bids
   */
  async runExpirySweep(req, res) {
    try {
      const { data, error } = await supabaseAdmin.rpc('sweep_expired_campaigns_and_bids');
      if (error) {
        throw new Error(`Expiry sweep failed: ${error.message}`);
      }
      res.json({ success: true, result: data && data[0] ? data[0] : data });
    } catch (error) {
      console.error("❌ Error running expiry sweep:", error);
      res.status(500).json({ success: false, message: "Failed to run expiry sweep", error: error.message });
    }
  }
  /**
   * Get all pending payments for admin
   */
  async getPendingPayments(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from("admin_payment_tracking")
        .select(`
          *,
          conversations (
            id,
            campaign_id,
            bid_id,
            brand_owner_id,
            influencer_id,
            campaigns (id, title, type:campaign_type)
          )
        `)
        .order("created_at", { ascending: false });

      // Filter by status if provided
      if (status) {
        if (status === "advance_pending") {
          query = query.eq("advance_payment_status", "admin_received");
        } else if (status === "final_pending") {
          query = query.eq("final_payment_status", "pending").eq("advance_payment_status", "admin_confirmed");
        }
      }

      const { data: payments, error, count } = await query
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error(`Failed to fetch pending payments: ${error.message}`);
      }

      // Format payment data
      const formattedPayments = payments.map(payment => {
        const conversation = payment.conversations;
        const collaborationType = conversation.campaign_id ? 'Campaign' : 'Direct';
        const collaborationTitle = conversation.campaign_id ?
          conversation.campaigns?.title :
          "Direct Payment";

        return {
          id: payment.id,
          conversation_id: payment.conversation_id,
          collaboration_type: collaborationType,
          collaboration_title: collaborationTitle,
          brand_owner_id: payment.brand_owner_id,
          influencer_id: payment.influencer_id,
          total_amount: payment.total_amount_paise / 100,
          commission_amount: payment.commission_amount_paise / 100,
          net_amount: payment.net_amount_paise / 100,
          advance_amount: payment.advance_amount_paise / 100,
          final_amount: payment.final_amount_paise / 100,
          commission_percentage: payment.commission_percentage,
          advance_payment_status: payment.advance_payment_status,
          final_payment_status: payment.final_payment_status,
          advance_confirmed_at: payment.advance_confirmed_at,
          final_confirmed_at: payment.final_confirmed_at,
          advance_screenshot_url: payment.advance_screenshot_url,
          final_screenshot_url: payment.final_screenshot_url,
          created_at: payment.created_at,
          // Determine current action needed
          current_action: this.getCurrentAction(payment),
          // Timeline status
          timeline: this.getPaymentTimeline(payment)
        };
      });

      res.json({
        success: true,
        payments: formattedPayments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });

    } catch (error) {
      console.error("❌ Error getting pending payments:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch pending payments",
        error: error.message
      });
    }
  }

  /**
   * Confirm advance payment
   */
  async confirmAdvancePayment(req, res) {
    try {
      const { payment_id } = req.params;
      const { screenshot_url } = req.body;

      const result = await adminPaymentFlowService.confirmAdvancePayment(payment_id, screenshot_url);

      if (result.success) {
        res.json({
          success: true,
          message: "Advance payment confirmed successfully",
          payment_record: result.payment_record
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Failed to confirm advance payment",
          error: result.error
        });
      }

    } catch (error) {
      console.error("❌ Error confirming advance payment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to confirm advance payment",
        error: error.message
      });
    }
  }

  /**
   * Process final payment
   */
  async processFinalPayment(req, res) {
    try {
      const { payment_id } = req.params;
      const { screenshot_url } = req.body;

      const result = await adminPaymentFlowService.processFinalPayment(payment_id, screenshot_url);

      if (result.success) {
        res.json({
          success: true,
          message: "Final payment processed successfully",
          payment_record: result.payment_record
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Failed to process final payment",
          error: result.error
        });
      }

    } catch (error) {
      console.error("❌ Error processing final payment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process final payment",
        error: error.message
      });
    }
  }

  /**
   * Get payment timeline for a conversation
   */
  async getPaymentTimeline(req, res) {
    try {
      const { conversation_id } = req.params;

      const result = await adminPaymentFlowService.getPaymentTimeline(conversation_id);

      if (result.success) {
        res.json({
          success: true,
          timeline: result.timeline,
          payment_record: result.payment_record
        });
      } else {
        res.status(404).json({
          success: false,
          message: result.error
        });
      }

    } catch (error) {
      console.error("❌ Error getting payment timeline:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get payment timeline",
        error: error.message
      });
    }
  }

  /**
   * Upload payment screenshot
   */
  async uploadScreenshot(req, res) {
    try {
      const { payment_id } = req.params;
      const { screenshot_url, payment_type } = req.body; // 'advance' or 'final'

      if (!screenshot_url || !payment_type) {
        return res.status(400).json({
          success: false,
          message: "Screenshot URL and payment type are required"
        });
      }

      // Update the appropriate screenshot field
      const updateField = payment_type === 'advance' ? 'advance_screenshot_url' : 'final_screenshot_url';

      const { data: updatedPayment, error } = await supabaseAdmin
        .from("admin_payment_tracking")
        .update({
          [updateField]: screenshot_url
        })
        .eq("id", payment_id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update screenshot: ${error.message}`);
      }

      res.json({
        success: true,
        message: "Screenshot uploaded successfully",
        payment_record: updatedPayment
      });

    } catch (error) {
      console.error("❌ Error uploading screenshot:", error);
      res.status(500).json({
        success: false,
        message: "Failed to upload screenshot",
        error: error.message
      });
    }
  }

  /**
   * Get payment statistics for admin dashboard
   */
  async getPaymentStatistics(req, res) {
    try {
      const { days = 30 } = req.query;

      // Get payment statistics
      const { data: stats, error } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select("*")
        .gte("created_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

      if (error) {
        throw new Error(`Failed to fetch payment statistics: ${error.message}`);
      }

      const statistics = {
        total_payments: stats.length,
        total_amount: stats.reduce((sum, payment) => sum + payment.total_amount_paise, 0) / 100,
        total_commission: stats.reduce((sum, payment) => sum + payment.commission_amount_paise, 0) / 100,
        total_net_amount: stats.reduce((sum, payment) => sum + payment.net_amount_paise, 0) / 100,
        advance_payments_confirmed: stats.filter(p => p.advance_payment_status === 'admin_confirmed').length,
        final_payments_confirmed: stats.filter(p => p.final_payment_status === 'admin_confirmed').length,
        pending_advance: stats.filter(p => p.advance_payment_status === 'admin_received').length,
        pending_final: stats.filter(p => p.final_payment_status === 'pending' && p.advance_payment_status === 'admin_confirmed').length
      };

      res.json({
        success: true,
        statistics: statistics,
        period_days: parseInt(days)
      });

    } catch (error) {
      console.error("❌ Error getting payment statistics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get payment statistics",
        error: error.message
      });
    }
  }

  /**
   * Helper method to determine current action needed
   */
  getCurrentAction(payment) {
    if (payment.advance_payment_status === 'admin_received') {
      return {
        type: 'confirm_advance',
        description: 'Confirm advance payment',
        amount: payment.advance_amount_paise / 100
      };
    } else if (payment.final_payment_status === 'pending' && payment.advance_payment_status === 'admin_confirmed') {
      return {
        type: 'process_final',
        description: 'Process final payment',
        amount: payment.final_amount_paise / 100
      };
    } else if (payment.final_payment_status === 'admin_confirmed') {
      return {
        type: 'completed',
        description: 'All payments completed',
        amount: 0
      };
    }
    return null;
  }

  /**
   * Helper method to get payment timeline
   */
  getPaymentTimeline(payment) {
    const timeline = [
      {
        event: "payment_initiated",
        timestamp: payment.created_at,
        status: "completed",
        description: "Payment breakdown created",
        amount: payment.total_amount_paise / 100
      }
    ];

    if (payment.advance_confirmed_at) {
      timeline.push({
        event: "advance_confirmed",
        timestamp: payment.advance_confirmed_at,
        status: payment.advance_payment_status,
        description: "Advance payment confirmed",
        amount: payment.advance_amount_paise / 100
      });
    }

    if (payment.final_confirmed_at) {
      timeline.push({
        event: "final_confirmed",
        timestamp: payment.final_confirmed_at,
        status: payment.final_payment_status,
        description: "Final payment confirmed",
        amount: payment.final_amount_paise / 100
      });
    }

    return timeline;
  }
}

module.exports = new AdminPaymentController();
