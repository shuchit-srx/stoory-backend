const { supabaseAdmin } = require("../supabase/client");

class TransactionFlowService {
  /**
   * Create transaction for conversation flow stage
   */
  async createFlowTransaction(conversationId, stage, data = {}) {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          brand_owner:users!conversations_brand_owner_id_fkey (id, name, phone),
          influencer:users!conversations_influencer_id_fkey (id, name, phone)
        `
        )
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error(`Conversation not found: ${convError?.message}`);
      }

      const brandOwner = conversation.brand_owner;
      const influencer = conversation.influencer;
      const brandOwnerName =
        brandOwner?.name || `+${brandOwner?.phone?.slice(-4)}` || "Brand Owner";
      const influencerName =
        influencer?.name || `+${influencer?.phone?.slice(-4)}` || "Influencer";

      // Get or create wallets
      const brandOwnerWallet = await this.getOrCreateWallet(
        conversation.brand_owner_id
      );
      const influencerWallet = await this.getOrCreateWallet(
        conversation.influencer_id
      );

      // Determine transaction details based on stage
      const transactionConfig = this.getTransactionConfig(stage, data, {
        conversation,
        brandOwnerName,
        influencerName,
        brandOwnerWallet,
        influencerWallet,
      });

      // Create transactions
      const transactions = [];
      for (const config of transactionConfig) {
        const { data: transaction, error: txError } = await supabaseAdmin
          .from("transactions")
          .insert(config)
          .select()
          .single();

        if (txError) {
          throw new Error(`Failed to create transaction: ${txError.message}`);
        }

        transactions.push(transaction);
      }

      return {
        success: true,
        transactions,
        stage,
        conversation_id: conversationId,
      };
    } catch (error) {
      console.error(
        `❌ Error creating flow transaction for stage ${stage}:`,
        error
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get or create wallet for user
   */
  async getOrCreateWallet(userId) {
    try {
      let { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error && error.code === "PGRST116") {
        // Wallet doesn't exist, create one
        const { data: newWallet, error: createError } = await supabaseAdmin
          .from("wallets")
          .insert({
            user_id: userId,
            balance: 0.0,
            balance_paise: 0,
            frozen_balance_paise: 0,
          })
          .select()
          .single();

        if (createError) {
          throw createError;
        }
        wallet = newWallet;
      } else if (error) {
        throw error;
      }

      return wallet;
    } catch (error) {
      throw new Error(`Failed to get/create wallet: ${error.message}`);
    }
  }

  /**
   * Get transaction configuration based on flow stage
   */
  getTransactionConfig(stage, data, context) {
    const {
      conversation,
      brandOwnerName,
      influencerName,
      brandOwnerWallet,
      influencerWallet,
    } = context;

    const sourceData = this.getSourceData(conversation);
    const amount = data.amount || conversation.flow_data?.agreed_amount || 0;
    const amountPaise = Math.round(amount * 100);

    switch (stage) {
      case "payment_initiated":
        return [
          {
            wallet_id: influencerWallet.id,
            user_id: conversation.influencer_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "credit",
            direction: "credit",
            status: "pending",
            stage: "order_created",
            notes: `Payment initiated from ${brandOwnerName} for collaboration`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            ...sourceData,
          },
          {
            wallet_id: brandOwnerWallet.id,
            user_id: conversation.brand_owner_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "debit",
            direction: "debit",
            status: "pending",
            stage: "order_created",
            notes: `Payment initiated to ${influencerName} for collaboration`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            ...sourceData,
          },
        ];

      case "payment_verified":
        return [
          {
            wallet_id: influencerWallet.id,
            user_id: conversation.influencer_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "credit",
            direction: "credit",
            status: "completed",
            stage: "verified",
            notes: `Payment verified from ${brandOwnerName} for collaboration`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            razorpay_order_id: data.razorpay_order_id,
            razorpay_payment_id: data.razorpay_payment_id,
            related_payment_order_id: data.payment_order_id,
            ...sourceData,
          },
          {
            wallet_id: brandOwnerWallet.id,
            user_id: conversation.brand_owner_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "debit",
            direction: "debit",
            status: "completed",
            stage: "verified",
            notes: `Payment verified to ${influencerName} for collaboration`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            razorpay_order_id: data.razorpay_order_id,
            razorpay_payment_id: data.razorpay_payment_id,
            related_payment_order_id: data.payment_order_id,
            ...sourceData,
          },
        ];

      case "escrow_hold":
        return [
          {
            wallet_id: influencerWallet.id,
            user_id: conversation.influencer_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "freeze",
            direction: "debit",
            status: "completed",
            stage: "escrow_hold",
            notes: `Funds frozen in escrow for collaboration`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            escrow_hold_id: data.escrow_hold_id,
            related_payment_order_id: data.payment_order_id,
            ...sourceData,
          },
        ];

      case "escrow_release":
        return [
          {
            wallet_id: influencerWallet.id,
            user_id: conversation.influencer_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "unfreeze",
            direction: "credit",
            status: "completed",
            stage: "escrow_release",
            notes: `Funds released from escrow - work approved`,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            escrow_hold_id: data.escrow_hold_id,
            ...sourceData,
          },
        ];

      case "refund":
        return [
          {
            wallet_id: brandOwnerWallet.id,
            user_id: conversation.brand_owner_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "credit",
            direction: "credit",
            status: "completed",
            stage: "refund",
            notes: `Refund processed for ${influencerName} collaboration`,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            ...sourceData,
          },
          {
            wallet_id: influencerWallet.id,
            user_id: conversation.influencer_id,
            amount: amount,
            amount_paise: amountPaise,
            type: "debit",
            direction: "debit",
            status: "completed",
            stage: "refund",
            notes: `Refund processed to ${brandOwnerName}`,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            ...sourceData,
          },
        ];

      default:
        throw new Error(`Unknown transaction stage: ${stage}`);
    }
  }

  /**
   * Get source data for transaction linking
   */
  getSourceData(conversation) {
    const sourceData = {};

    if (conversation.request_id) {
      sourceData.request_id = conversation.request_id;
    }

    if (conversation.campaign_id) {
      sourceData.campaign_id = conversation.campaign_id;
    } else if (conversation.bid_id) {
      sourceData.bid_id = conversation.bid_id;
    }

    if (conversation.id) {
      sourceData.conversation_id = conversation.id;
    }

    return sourceData;
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(transactionId, status, stage = null) {
    try {
      const updateData = { status };
      if (stage) {
        updateData.stage = stage;
      }

      const { data: transaction, error } = await supabaseAdmin
        .from("transactions")
        .update(updateData)
        .eq("id", transactionId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        success: true,
        transaction,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transaction history for conversation
   */
  async getConversationTransactions(conversationId) {
    try {
      const { data: transactions, error } = await supabaseAdmin
        .from("transactions")
        .select(
          `
          *,
          sender:users!transactions_sender_id_fkey (id, name, phone),
          receiver:users!transactions_receiver_id_fkey (id, name, phone),
          escrow_hold:escrow_holds (id, status, created_at, released_at)
        `
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return {
        success: true,
        transactions: transactions || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transaction summary for user
   */
  async getUserTransactionSummary(userId) {
    try {
      const { data: summary, error } = await supabaseAdmin
        .from("user_transaction_summary")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        throw error;
      }

      return {
        success: true,
        summary,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate transaction consistency
   */
  async validateConsistency() {
    try {
      const { data: issues, error } = await supabaseAdmin.rpc(
        "validate_transaction_consistency"
      );

      if (error) {
        throw error;
      }

      return {
        success: true,
        issues: issues || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new TransactionFlowService();
