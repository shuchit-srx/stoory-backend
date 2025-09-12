const crypto = require("crypto");
const { supabaseAdmin } = require("../supabase/client");

class PaymentService {
  /**
   * Verify payment signature from frontend
   */
  verifyPaymentSignature(orderId, paymentId, signature, secret) {
    const text = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(text)
      .digest("hex");

    return generatedSignature === signature;
  }

  /**
   * Process payment response from frontend
   */
  async processPaymentResponse(paymentData) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        conversation_id,
        amount_paise,
      } = paymentData;

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          request:requests (
            id,
            final_agreed_amount,
            influencer_id,
            campaign_id,
            bid_id
          ),
          influencer:users!conversations_influencer_id_fkey (
            id,
            wallets (id, balance_paise, frozen_balance_paise)
          )
        `
        )
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Verify payment signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      if (razorpay_signature !== expectedSignature) {
        throw new Error("Invalid payment signature");
      }

      // Check for duplicate payment
      const { data: existingTransaction } = await supabaseAdmin
        .from("transactions")
        .select("id")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .single();

      if (existingTransaction) {
        throw new Error("Payment already processed");
      }

      // Get payment amount
      const paymentAmount =
        amount_paise ||
        Math.round((conversation.request?.final_agreed_amount || 1000) * 100);
      const wallet = conversation.influencer.wallets;

      // Update wallet balance (add payment amount in paise)
      const newBalance = (wallet.balance_paise || 0) + paymentAmount;
      const { error: walletUpdateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
        })
        .eq("id", wallet.id);

      if (walletUpdateError) {
        throw new Error(
          `Failed to update wallet balance: ${walletUpdateError.message}`
        );
      }

      // Create payment order
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("payment_orders")
        .insert({
          conversation_id: conversation_id,
          amount_paise: paymentAmount,
          currency: "INR",
          status: "verified",
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          razorpay_signature: razorpay_signature,
          metadata: {
            conversation_type: conversation.bid_id ? "bid" : "campaign",
            brand_owner_id: conversation.brand_owner_id,
            influencer_id: conversation.influencer_id,
          },
        })
        .select()
        .single();

      if (orderError) {
        throw new Error(
          `Failed to create payment order: ${orderError.message}`
        );
      }

      // Get or create brand owner wallet for debit transaction
      let { data: brandOwnerWallet, error: brandOwnerWalletError } =
        await supabaseAdmin
          .from("wallets")
          .select("*")
          .eq("user_id", conversation.brand_owner_id)
          .single();

      if (brandOwnerWalletError && brandOwnerWalletError.code === "PGRST116") {
        // Create brand owner wallet if it doesn't exist
        const {
          data: newBrandOwnerWallet,
          error: createBrandOwnerWalletError,
        } = await supabaseAdmin
          .from("wallets")
          .insert({
            user_id: conversation.brand_owner_id,
            balance: 0.0,
            balance_paise: 0,
            frozen_balance_paise: 0,
          })
          .select()
          .single();

        if (createBrandOwnerWalletError) {
          throw new Error(
            `Failed to create brand owner wallet: ${createBrandOwnerWalletError.message}`
          );
        }
        brandOwnerWallet = newBrandOwnerWallet;
      } else if (brandOwnerWalletError) {
        throw new Error(
          `Failed to get brand owner wallet: ${brandOwnerWalletError.message}`
        );
      }

      // Create source reference data for both transactions
      const sourceData = {};
      if (conversation.request) {
        if (conversation.request.campaign_id) {
          sourceData.campaign_id = conversation.request.campaign_id;
        } else if (conversation.request.bid_id) {
          sourceData.bid_id = conversation.request.bid_id;
        }
        sourceData.request_id = conversation.request.id;
      } else if (conversation.campaign_id) {
        sourceData.campaign_id = conversation.campaign_id;
      } else if (conversation.bid_id) {
        sourceData.bid_id = conversation.bid_id;
      }

      // Get user names for better transaction tracking
      const { data: brandOwner, error: brandOwnerError } = await supabaseAdmin
        .from("users")
        .select("name, phone")
        .eq("id", conversation.brand_owner_id)
        .single();

      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("users")
        .select("name, phone")
        .eq("id", conversation.influencer_id)
        .single();

      const brandOwnerName =
        brandOwner?.name || `+${brandOwner?.phone?.slice(-4)}` || "Brand Owner";
      const influencerName =
        influencer?.name || `+${influencer?.phone?.slice(-4)}` || "Influencer";

      // Create CREDIT transaction for influencer
      const influencerTransactionData = {
        wallet_id: wallet.id,
        user_id: conversation.influencer_id,
        amount: paymentAmount / 100, // Keep old amount field for compatibility
        amount_paise: paymentAmount,
        type: "credit",
        direction: "credit",
        status: "completed",
        stage: "verified",
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        related_payment_order_id: paymentOrder.id,
        payment_stage: "bid_collaboration",
        notes: `Payment received from ${brandOwnerName} for campaign collaboration`,
        sender_id: conversation.brand_owner_id,
        receiver_id: conversation.influencer_id,
        ...sourceData,
      };

      // Create DEBIT transaction for brand owner
      const brandOwnerTransactionData = {
        wallet_id: brandOwnerWallet.id,
        user_id: conversation.brand_owner_id,
        amount: paymentAmount / 100, // Keep old amount field for compatibility
        amount_paise: paymentAmount,
        type: "debit",
        direction: "debit",
        status: "completed",
        stage: "verified",
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        related_payment_order_id: paymentOrder.id,
        payment_stage: "bid_collaboration",
        notes: `Payment sent to ${influencerName} for campaign collaboration`,
        sender_id: conversation.brand_owner_id,
        receiver_id: conversation.influencer_id,
        ...sourceData,
      };

      // Insert both transactions
      const { data: influencerTransaction, error: influencerTransactionError } =
        await supabaseAdmin
          .from("transactions")
          .insert(influencerTransactionData)
          .select()
          .single();

      if (influencerTransactionError) {
        throw new Error(
          `Failed to create influencer transaction record: ${influencerTransactionError.message}`
        );
      }

      const { data: brandOwnerTransaction, error: brandOwnerTransactionError } =
        await supabaseAdmin
          .from("transactions")
          .insert(brandOwnerTransactionData)
          .select()
          .single();

      if (brandOwnerTransactionError) {
        throw new Error(
          `Failed to create brand owner transaction record: ${brandOwnerTransactionError.message}`
        );
      }

      // Update request status to "paid" if request exists
      if (conversation.request) {
        const { error: requestUpdateError } = await supabaseAdmin
          .from("requests")
          .update({
            status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation.request.id);

        if (requestUpdateError) {
          console.error("Request update error:", requestUpdateError);
          // Don't fail the payment, just log the error
        }
      }

      // Update source status (campaign or bid) to "pending" (work in progress)
      if (conversation.campaign_id) {
        await supabaseAdmin
          .from("campaigns")
          .update({ status: "pending" })
          .eq("id", conversation.campaign_id);
      } else if (conversation.bid_id) {
        await supabaseAdmin
          .from("bids")
          .update({ status: "pending" })
          .eq("id", conversation.bid_id);
      }

      // Create escrow hold
      const { data: escrowHold, error: escrowError } = await supabaseAdmin
        .from("escrow_holds")
        .insert({
          conversation_id: conversation_id,
          payment_order_id: paymentOrder.id,
          amount_paise: paymentAmount,
          status: "held",
        })
        .select()
        .single();

      if (escrowError) {
        console.error("Escrow hold creation error:", escrowError);
        // Continue anyway as the payment is processed
      }

      return {
        success: true,
        transactions: {
          influencer: influencerTransaction,
          brand_owner: brandOwnerTransaction,
        },
        payment_order: paymentOrder,
        escrow_hold: escrowHold,
        message: "Payment processed successfully with dual transaction records",
      };
    } catch (error) {
      console.error("Error processing payment response:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create payment order
   */
  async createPaymentOrder(orderData) {
    try {
      const { conversationId, amount, paymentType } = orderData;

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          request:requests (
            id,
            final_agreed_amount,
            influencer_id,
            campaign_id,
            bid_id
          )
        `
        )
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Get payment amount
      const paymentAmount =
        amount || conversation.request?.final_agreed_amount || 0;
      const amountPaise = Math.round(parseFloat(paymentAmount) * 100);

      if (amountPaise <= 0) {
        throw new Error("Invalid payment amount");
      }

      // Create payment order
      const { data: paymentOrder, error: orderError } = await supabaseAdmin
        .from("payment_orders")
        .insert({
          conversation_id: conversationId,
          amount_paise: amountPaise,
          currency: "INR",
          status: "created",
          metadata: {
            conversation_type: conversation.bid_id ? "bid" : "campaign",
            brand_owner_id: conversation.brand_owner_id,
            influencer_id: conversation.influencer_id,
            payment_type: paymentType || "bid_collaboration",
          },
        })
        .select()
        .single();

      if (orderError) {
        throw new Error(
          `Failed to create payment order: ${orderError.message}`
        );
      }

      // Generate Razorpay order (this would typically call Razorpay API)
      const razorpayConfig = {
        order_id: paymentOrder.id, // Use our order ID as Razorpay order ID for now
        amount: amountPaise,
        currency: "INR",
        receipt: `order_${paymentOrder.id}`,
        notes: {
          conversation_id: conversationId,
          payment_type: paymentType || "bid_collaboration",
        },
      };

      return {
        success: true,
        payment_order: paymentOrder,
        razorpayConfig,
        message: "Payment order created successfully",
      };
    } catch (error) {
      console.error("Error creating payment order:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transaction history for a user
   */
  async getTransactionHistory(userId, page = 1, limit = 10, status = null) {
    try {
      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from("transactions")
        .select(
          `
                    *,
                    wallets!inner (
                        user_id
                    ),
                    campaigns (
                        id,
                        title,
                        type:campaign_type
                    )
                `,
          { count: "exact" }
        )
        .eq("wallets.user_id", userId);

      if (status) {
        query = query.eq("status", status);
      }

      const {
        data: transactions,
        error,
        count,
      } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error("Failed to fetch transactions");
      }

      return {
        success: true,
        transactions: transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId) {
    try {
      const { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("user_id", userId)
        .single();

      if (error || !wallet) {
        throw new Error("Wallet not found");
      }

      return {
        success: true,
        balance: wallet.balance,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(userId) {
    try {
      const { data: transactions, error } = await supabaseAdmin
        .from("transactions")
        .select(
          `
                    amount,
                    type,
                    status,
                    wallets!inner (
                        user_id
                    )
                `
        )
        .eq("wallets.user_id", userId);

      if (error) {
        throw new Error("Failed to fetch payment statistics");
      }

      const stats = {
        totalEarnings: 0,
        totalSpent: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
        failedTransactions: 0,
      };

      transactions.forEach((transaction) => {
        const amount = parseFloat(transaction.amount);

        if (transaction.type === "credit") {
          stats.totalEarnings += amount;
        } else if (transaction.type === "debit") {
          stats.totalSpent += amount;
        }

        switch (transaction.status) {
          case "completed":
            stats.completedTransactions++;
            break;
          case "pending":
            stats.pendingTransactions++;
            break;
          case "failed":
            stats.failedTransactions++;
            break;
        }
      });

      return {
        success: true,
        stats: stats,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create a refund record
   */
  async createRefundRecord(paymentId, amount, reason) {
    try {
      // Update original transaction status
      const { error: updateError } = await supabaseAdmin
        .from("transactions")
        .update({ status: "refunded" })
        .eq("razorpay_payment_id", paymentId);

      if (updateError) {
        throw new Error("Failed to update transaction status");
      }

      // Create refund transaction record
      const { data: refundTransaction, error: refundError } =
        await supabaseAdmin
          .from("transactions")
          .insert({
            amount: amount,
            type: "debit",
            status: "completed",
            razorpay_payment_id: paymentId,
            notes: `Refund: ${reason}`,
          })
          .select()
          .single();

      if (refundError) {
        throw new Error("Failed to create refund record");
      }

      return {
        success: true,
        refund: refundTransaction,
        message: "Refund processed successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new PaymentService();
