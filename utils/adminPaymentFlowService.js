const { supabaseAdmin } = require("../supabase/client");
const notificationService = require("../services/notificationService");

const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

class AdminPaymentFlowService {
  constructor() {
    this.io = null;
  }

  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Initialize admin payment flow when brand owner agrees to pay
   */
  async initiateAdminPaymentFlow(conversationId, agreedAmount) {
    try {
      console.log("🔍 [ADMIN PAYMENT] Initiating payment flow for conversation:", conversationId);

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(`
          *,
          campaigns (id, title, type:campaign_type),
          bids (id, title, type:bid_type)
        `)
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Calculate payment breakdown
      const paymentBreakdown = await this.calculatePaymentBreakdown(agreedAmount);
      
      // Create admin payment tracking record
      const { data: paymentRecord, error: paymentError } = await supabaseAdmin
        .from("admin_payment_tracking")
        .insert({
          conversation_id: conversationId,
          campaign_id: conversation.campaign_id,
          bid_id: conversation.bid_id,
          brand_owner_id: conversation.brand_owner_id,
          influencer_id: conversation.influencer_id,
          total_amount_paise: paymentBreakdown.total_amount_paise,
          commission_amount_paise: paymentBreakdown.commission_amount_paise,
          net_amount_paise: paymentBreakdown.net_amount_paise,
          advance_amount_paise: paymentBreakdown.advance_amount_paise,
          final_amount_paise: paymentBreakdown.final_amount_paise,
          commission_percentage: paymentBreakdown.commission_percentage,
          advance_payment_status: 'admin_received',
          final_payment_status: 'pending'
        })
        .select()
        .single();

      if (paymentError) {
        throw new Error(`Failed to create payment record: ${paymentError.message}`);
      }

      // Create persistent admin notifications for advance processing
      try {
        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .eq('is_deleted', false);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 60); // persist ~60 days

        if (Array.isArray(admins)) {
          for (const admin of admins) {
            await notificationService.storeNotification({
              user_id: admin.id,
              type: 'admin_payment_pending_advance',
              title: 'Advance payment pending release',
              message: 'A new advance payment is awaiting admin release',
              priority: 'high',
              expires_at: expiresAt.toISOString(),
              data: {
                conversation_id: conversationId,
                admin_payment_tracking_id: paymentRecord.id,
                advance_amount_paise: paymentBreakdown.advance_amount_paise
              }
            });
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to create admin notifications for advance pending:', e.message);
      }

      // Update conversation state
      await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "admin_payment_received",
          awaiting_role: "admin",
          flow_data: {
            ...conversation.flow_data,
            payment_breakdown: paymentBreakdown,
            admin_payment_tracking_id: paymentRecord.id
          }
        })
        .eq("id", conversationId);

      // Send payment breakdown message
      await this.sendPaymentBreakdownMessage(conversationId, paymentBreakdown, conversation);

      // Create pending transaction records
      await this.createPendingTransactions(paymentRecord.id, conversationId, paymentBreakdown);

      return {
        success: true,
        payment_record: paymentRecord,
        payment_breakdown: paymentBreakdown
      };

    } catch (error) {
      console.error("❌ [ADMIN PAYMENT] Error initiating payment flow:", error);
      throw error;
    }
  }

  /**
   * Calculate payment breakdown with commission
   */
  async calculatePaymentBreakdown(agreedAmount) {
    try {
      // Get current commission settings
      const { data: commissionSettings, error: commError } = await supabaseAdmin
        .from("commission_settings")
        .select("*")
        .eq("is_active", true)
        .order("effective_from", { ascending: false })
        .limit(1)
        .single();

      if (commError || !commissionSettings) {
        throw new Error("No active commission settings found. Please configure commission in admin settings.");
      }
      const commissionPercentage = commissionSettings.commission_percentage;

      const totalAmountPaise = Math.round(agreedAmount * 100);
      const commissionAmountPaise = Math.round((totalAmountPaise * commissionPercentage) / 100);
      const netAmountPaise = totalAmountPaise - commissionAmountPaise;
      const advanceAmountPaise = Math.round(netAmountPaise * 0.30); // 30%
      const finalAmountPaise = netAmountPaise - advanceAmountPaise; // 70%

      return {
        total_amount_paise: totalAmountPaise,
        commission_amount_paise: commissionAmountPaise,
        net_amount_paise: netAmountPaise,
        advance_amount_paise: advanceAmountPaise,
        final_amount_paise: finalAmountPaise,
        commission_percentage: commissionPercentage
      };
    } catch (error) {
      console.error("❌ Error calculating payment breakdown:", error);
      throw error;
    }
  }

  /**
   * Send payment breakdown message to conversation
   */
  async sendPaymentBreakdownMessage(conversationId, breakdown, conversation) {
    try {
      const collaborationType = conversation.campaign_id ? 'Campaign' : 'Bid';
      const collaborationTitle = conversation.campaign_id ? 
        conversation.campaigns?.title : 
        conversation.bids?.title;

      const message = `💳 **Payment Breakdown - ${collaborationType} Collaboration**

📋 **Project:** ${collaborationTitle}
💰 **Total Amount:** ₹${breakdown.total_amount_paise / 100}
💼 **Commission (${breakdown.commission_percentage}%):** ₹${breakdown.commission_amount_paise / 100}
💵 **Net Amount:** ₹${breakdown.net_amount_paise / 100}

📊 **Payment Schedule:**
• **Advance Payment:** ₹${breakdown.advance_amount_paise / 100} (30%)
• **Final Payment:** ₹${breakdown.final_amount_paise / 100} (70%)

⏳ **Status:** Waiting for admin to process advance payment...`;

      // Send message to both participants
      const messages = [
        {
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.brand_owner_id,
          message: message,
          message_type: "payment_breakdown",
          action_required: false
        },
        {
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.influencer_id,
          message: message,
          message_type: "payment_breakdown",
          action_required: false
        }
      ];

      const { data: insertedMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messages)
        .select();

      if (messageError) {
        throw new Error(`Failed to send payment breakdown message: ${messageError.message}`);
      }

      // Emit real-time update
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit("new_message", {
          conversation_id: conversationId,
          messages: insertedMessages
        });
      }

      return insertedMessages;
    } catch (error) {
      console.error("❌ Error sending payment breakdown message:", error);
      throw error;
    }
  }

  /**
   * Create pending transaction records
   */
  async createPendingTransactions(paymentRecordId, conversationId, breakdown) {
    try {
      // Get influencer wallet
      const { data: influencerWallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", (await supabaseAdmin.from("conversations").select("influencer_id").eq("id", conversationId).single()).data.influencer_id)
        .single();

      if (walletError) {
        throw new Error(`Failed to get influencer wallet: ${walletError.message}`);
      }

      // Create advance transaction (pending)
      const advanceTransaction = {
        wallet_id: influencerWallet.id,
        amount: breakdown.advance_amount_paise / 100,
        amount_paise: breakdown.advance_amount_paise,
        type: "credit",
        status: "pending",
        campaign_id: (await supabaseAdmin.from("conversations").select("campaign_id").eq("id", conversationId).single()).data.campaign_id,
        bid_id: (await supabaseAdmin.from("conversations").select("bid_id").eq("id", conversationId).single()).data.bid_id,
        conversation_id: conversationId,
        payment_stage: "advance",
        admin_payment_tracking_id: paymentRecordId,
        description: "Advance payment (30% after commission)"
      };

      // Create final transaction (pending)
      const finalTransaction = {
        wallet_id: influencerWallet.id,
        amount: breakdown.final_amount_paise / 100,
        amount_paise: breakdown.final_amount_paise,
        type: "credit",
        status: "pending",
        campaign_id: advanceTransaction.campaign_id,
        bid_id: advanceTransaction.bid_id,
        conversation_id: conversationId,
        payment_stage: "final",
        admin_payment_tracking_id: paymentRecordId,
        description: "Final payment (70% after commission)"
      };

      const { data: transactions, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert([advanceTransaction, finalTransaction])
        .select();

      if (transactionError) {
        throw new Error(`Failed to create transaction records: ${transactionError.message}`);
      }

      return transactions;
    } catch (error) {
      console.error("❌ Error creating pending transactions:", error);
      throw error;
    }
  }

  /**
   * Admin confirms advance payment
   */
  async confirmAdvancePayment(paymentRecordId, screenshotUrl = null) {
    try {
      console.log("🔍 [ADMIN PAYMENT] Confirming advance payment:", paymentRecordId);

      // Get payment record
      const { data: paymentRecord, error: paymentError } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select(`
          *,
          conversations (
            id,
            campaign_id,
            bid_id,
            brand_owner_id,
            influencer_id,
            campaigns (title),
            bids (title)
          )
        `)
        .eq("id", paymentRecordId)
        .single();

      if (paymentError || !paymentRecord) {
        throw new Error("Payment record not found");
      }

      // Update payment status
      await supabaseAdmin
        .from("admin_payment_tracking")
        .update({
          advance_payment_status: "admin_confirmed",
          advance_screenshot_url: screenshotUrl,
          advance_confirmed_at: new Date().toISOString()
        })
        .eq("id", paymentRecordId);

      // Update advance transaction status and credit influencer wallet
      const { data: advanceTx, error: fetchTxError } = await supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("admin_payment_tracking_id", paymentRecordId)
        .eq("payment_stage", "advance")
        .single();

      if (!fetchTxError && advanceTx) {
        // Credit wallet balance
        await supabaseAdmin.rpc('wallet_credit_by_paise', {
          p_user_id: paymentRecord.influencer_id,
          p_amount_paise: advanceTx.amount_paise,
          p_meta: {
            conversation_id: paymentRecord.conversation_id,
            stage: 'advance',
            admin_payment_tracking_id: paymentRecordId
          }
        }).catch(() => {});

        await supabaseAdmin
          .from("transactions")
          .update({
            status: "completed",
            direction: 'credit',
            razorpay_payment_id: `admin_advance_${paymentRecordId}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", advanceTx.id);
      }

      // Update conversation state
      await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "advance_payment_sent",
          awaiting_role: "influencer"
        })
        .eq("id", paymentRecord.conversation_id);

      // Send advance payment confirmation message
      await this.sendAdvancePaymentConfirmation(paymentRecord, screenshotUrl);

      // Resolve admin pending advance notifications
      try {
        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .eq('is_deleted', false);
        if (Array.isArray(admins)) {
          for (const admin of admins) {
            await supabaseAdmin
              .from('notifications')
              .update({ status: 'delivered', read_at: new Date().toISOString() })
              .eq('user_id', admin.id)
              .eq('type', 'admin_payment_pending_advance')
              .eq('data->>admin_payment_tracking_id', String(paymentRecordId));
          }
        }
      } catch {}

      return {
        success: true,
        payment_record: paymentRecord
      };

    } catch (error) {
      console.error("❌ [ADMIN PAYMENT] Error confirming advance payment:", error);
      throw error;
    }
  }

  /**
   * Send advance payment confirmation message
   */
  async sendAdvancePaymentConfirmation(paymentRecord, screenshotUrl) {
    try {
      const conversation = paymentRecord.conversations;
      const collaborationType = conversation.campaign_id ? 'Campaign' : 'Bid';
      const collaborationTitle = conversation.campaign_id ? 
        conversation.campaigns?.title : 
        conversation.bids?.title;

      const message = `✅ **Advance Payment Confirmed!**

📋 **Project:** ${collaborationTitle}
💰 **Amount Received:** ₹${paymentRecord.advance_amount_paise / 100}
📊 **Type:** Advance Payment (30% of net amount)
💵 **Net Amount:** ₹${paymentRecord.net_amount_paise / 100}
💼 **Commission:** ₹${paymentRecord.commission_amount_paise / 100} (${paymentRecord.commission_percentage}%)

🎯 **Next Step:** You can now start working on this project!
📅 **Timeline:** Submit your work when ready for final payment.`;

      const messages = [
        {
          conversation_id: paymentRecord.conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.brand_owner_id,
          message: message,
          message_type: "system_info",
          media_url: screenshotUrl,
          action_required: false
        },
        {
          conversation_id: paymentRecord.conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.influencer_id,
          message: message,
          message_type: "system_info",
          media_url: screenshotUrl,
          action_required: false
        }
      ];

      const { data: insertedMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messages)
        .select();

      if (messageError) {
        throw new Error(`Failed to send advance payment confirmation: ${messageError.message}`);
      }

      // Emit real-time update
      if (this.io) {
        this.io.to(`conversation_${paymentRecord.conversation_id}`).emit("new_message", {
          conversation_id: paymentRecord.conversation_id,
          messages: insertedMessages
        });
      }

      return insertedMessages;
    } catch (error) {
      console.error("❌ Error sending advance payment confirmation:", error);
      throw error;
    }
  }

  /**
   * Admin processes final payment
   */
  async processFinalPayment(paymentRecordId, screenshotUrl = null) {
    try {
      console.log("🔍 [ADMIN PAYMENT] Processing final payment:", paymentRecordId);

      // Get payment record
      const { data: paymentRecord, error: paymentError } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select(`
          *,
          conversations (
            id,
            campaign_id,
            bid_id,
            brand_owner_id,
            influencer_id,
            campaigns (title),
            bids (title)
          )
        `)
        .eq("id", paymentRecordId)
        .single();

      if (paymentError || !paymentRecord) {
        throw new Error("Payment record not found");
      }

      // Update payment status
      await supabaseAdmin
        .from("admin_payment_tracking")
        .update({
          final_payment_status: "admin_confirmed",
          final_screenshot_url: screenshotUrl,
          final_confirmed_at: new Date().toISOString()
        })
        .eq("id", paymentRecordId);

      // Update final transaction status and credit wallet
      const { data: finalTx, error: fetchFinalTxError } = await supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("admin_payment_tracking_id", paymentRecordId)
        .eq("payment_stage", "final")
        .single();

      if (!fetchFinalTxError && finalTx) {
        await supabaseAdmin.rpc('wallet_credit_by_paise', {
          p_user_id: paymentRecord.influencer_id,
          p_amount_paise: finalTx.amount_paise,
          p_meta: {
            conversation_id: paymentRecord.conversation_id,
            stage: 'final',
            admin_payment_tracking_id: paymentRecordId
          }
        }).catch(() => {});

        await supabaseAdmin
          .from("transactions")
          .update({
            status: "completed",
            direction: 'credit',
            razorpay_payment_id: `admin_final_${paymentRecordId}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", finalTx.id);
      }

      // Update conversation state to closed
      await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "chat_closed",
          chat_status: "closed",
          awaiting_role: null
        })
        .eq("id", paymentRecord.conversation_id);

      // Send final payment confirmation message
      await this.sendFinalPaymentConfirmation(paymentRecord, screenshotUrl);

      // Resolve admin pending final notifications
      try {
        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .eq('is_deleted', false);
        if (Array.isArray(admins)) {
          for (const admin of admins) {
            await supabaseAdmin
              .from('notifications')
              .update({ status: 'delivered', read_at: new Date().toISOString() })
              .eq('user_id', admin.id)
              .eq('type', 'admin_payment_pending_final')
              .eq('data->>admin_payment_tracking_id', String(paymentRecordId));
          }
        }
      } catch {}

      return {
        success: true,
        payment_record: paymentRecord
      };

    } catch (error) {
      console.error("❌ [ADMIN PAYMENT] Error processing final payment:", error);
      throw error;
    }
  }

  /**
   * Send final payment confirmation message
   */
  async sendFinalPaymentConfirmation(paymentRecord, screenshotUrl) {
    try {
      const conversation = paymentRecord.conversations;
      const collaborationType = conversation.campaign_id ? 'Campaign' : 'Bid';
      const collaborationTitle = conversation.campaign_id ? 
        conversation.campaigns?.title : 
        conversation.bids?.title;

      const message = `🎉 **Final Payment Confirmed!**

📋 **Project:** ${collaborationTitle}
💰 **Final Amount:** ₹${paymentRecord.final_amount_paise / 100}
📊 **Type:** Final Payment (70% of net amount)

📈 **Payment Summary:**
• **Advance Received:** ₹${paymentRecord.advance_amount_paise / 100}
• **Final Received:** ₹${paymentRecord.final_amount_paise / 100}
• **Total Earned:** ₹${paymentRecord.net_amount_paise / 100}
• **Commission:** ₹${paymentRecord.commission_amount_paise / 100} (${paymentRecord.commission_percentage}%)

✅ **Collaboration Completed Successfully!**
🎯 This conversation is now closed. Thank you for your excellent work!`;

      const messages = [
        {
          conversation_id: paymentRecord.conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.brand_owner_id,
          message: message,
          message_type: "system_info",
          media_url: screenshotUrl,
          action_required: false
        },
        {
          conversation_id: paymentRecord.conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.influencer_id,
          message: message,
          message_type: "system_info",
          media_url: screenshotUrl,
          action_required: false
        }
      ];

      const { data: insertedMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messages)
        .select();

      if (messageError) {
        throw new Error(`Failed to send final payment confirmation: ${messageError.message}`);
      }

      // Emit real-time update
      if (this.io) {
        this.io.to(`conversation_${paymentRecord.conversation_id}`).emit("new_message", {
          conversation_id: paymentRecord.conversation_id,
          messages: insertedMessages
        });
      }

      return insertedMessages;
    } catch (error) {
      console.error("❌ Error sending final payment confirmation:", error);
      throw error;
    }
  }

  /**
   * Get payment timeline for a conversation
   */
  async getPaymentTimeline(conversationId) {
    try {
      const { data: paymentRecord, error: paymentError } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select("*")
        .eq("conversation_id", conversationId)
        .single();

      if (paymentError || !paymentRecord) {
        return { success: false, error: "Payment record not found" };
      }

      const timeline = [
        {
          event: "payment_initiated",
          timestamp: paymentRecord.created_at,
          status: "completed",
          description: "Payment breakdown created",
          amount: paymentRecord.total_amount_paise / 100
        },
        {
          event: "advance_payment",
          timestamp: paymentRecord.advance_confirmed_at,
          status: paymentRecord.advance_payment_status,
          description: "Advance payment processing",
          amount: paymentRecord.advance_amount_paise / 100
        },
        {
          event: "final_payment",
          timestamp: paymentRecord.final_confirmed_at,
          status: paymentRecord.final_payment_status,
          description: "Final payment processing",
          amount: paymentRecord.final_amount_paise / 100
        }
      ];

      return {
        success: true,
        timeline: timeline,
        payment_record: paymentRecord
      };
    } catch (error) {
      console.error("❌ Error getting payment timeline:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AdminPaymentFlowService();
