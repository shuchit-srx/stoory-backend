const { supabaseAdmin } = require("../supabase/client");

class EnhancedBalanceService {
  /**
   * Get user's wallet balance with comprehensive breakdown
   */
  async getWalletBalance(userId) {
    try {
      console.log("🔍 [DEBUG] getWalletBalance called for user:", userId);
      
      const { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .single();

      console.log("🔍 [DEBUG] Wallet query result:", { wallet, error });

      if (error) {
        console.log("🔍 [DEBUG] Wallet query error:", error);
        if (error.code === "PGRST116") {
          console.log("🔍 [DEBUG] Wallet doesn't exist, creating one...");
          // Wallet doesn't exist, create one
          return await this.createWallet(userId);
        }
        throw error;
      }

      // Calculate comprehensive balance breakdown
      const availableBalancePaise = wallet.balance_paise || 0;
      const frozenBalancePaise = wallet.frozen_balance_paise || 0;
      const withdrawnBalancePaise = wallet.withdrawn_balance_paise || 0;
      const totalBalancePaise = wallet.total_balance_paise || (availableBalancePaise + frozenBalancePaise + withdrawnBalancePaise);

      return {
        success: true,
        wallet: {
          id: wallet.id,
          user_id: wallet.user_id,
          // Legacy fields for compatibility
          balance: wallet.balance,
          balance_paise: availableBalancePaise,
          frozen_balance_paise: frozenBalancePaise,
          // New comprehensive fields
          withdrawn_balance_paise: withdrawnBalancePaise,
          total_balance_paise: totalBalancePaise,
          // Rupee equivalents
          available_balance_rupees: Math.round(availableBalancePaise) / 100,
          frozen_balance_rupees: Math.round(frozenBalancePaise) / 100,
          withdrawn_balance_rupees: Math.round(withdrawnBalancePaise) / 100,
          total_balance_rupees: Math.round(totalBalancePaise) / 100,
          created_at: wallet.created_at,
          updated_at: wallet.updated_at,
        },
        // Balance summary for easy access
        balance_summary: {
          available: availableBalancePaise,
          frozen: frozenBalancePaise,
          withdrawn: withdrawnBalancePaise,
          total: totalBalancePaise,
          available_rupees: Math.round(availableBalancePaise) / 100,
          frozen_rupees: Math.round(frozenBalancePaise) / 100,
          withdrawn_rupees: Math.round(withdrawnBalancePaise) / 100,
          total_rupees: Math.round(totalBalancePaise) / 100,
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create a new wallet for user with enhanced tracking
   */
  async createWallet(userId) {
    try {
      console.log("🔍 [DEBUG] createWallet called for user:", userId);
      
      const { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .insert({
          user_id: userId,
          balance: 0.0,
          balance_paise: 0,
          frozen_balance_paise: 0,
          withdrawn_balance_paise: 0,
          total_balance_paise: 0,
        })
        .select()
        .single();

      console.log("🔍 [DEBUG] Wallet creation result:", { wallet, error });

      if (error) {
        console.error("❌ [DEBUG] Wallet creation error:", error);
        throw error;
      }

      return {
        success: true,
        wallet: {
          id: wallet.id,
          user_id: wallet.user_id,
          balance: 0,
          balance_paise: 0,
          frozen_balance_paise: 0,
          withdrawn_balance_paise: 0,
          total_balance_paise: 0,
          available_balance_rupees: 0,
          frozen_balance_rupees: 0,
          withdrawn_balance_rupees: 0,
          total_balance_rupees: 0,
        },
        balance_summary: {
          available: 0,
          frozen: 0,
          withdrawn: 0,
          total: 0,
          available_rupees: 0,
          frozen_rupees: 0,
          withdrawn_rupees: 0,
          total_rupees: 0,
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Add funds to wallet (for payments received)
   */
  async addFunds(userId, amountPaise, transactionData = {}) {
    try {
      console.log("🔍 [DEBUG] addFunds called with:", { userId, amountPaise, transactionData });
      
      // Get or create wallet
      console.log("🔍 [DEBUG] Getting wallet balance for user:", userId);
      const walletResult = await this.getWalletBalance(userId);
      console.log("🔍 [DEBUG] Wallet result:", walletResult);
      
      if (!walletResult.success) {
        console.error("❌ [DEBUG] Failed to get wallet balance:", walletResult.error);
        return walletResult;
      }

      const wallet = walletResult.wallet;
      console.log("🔍 [DEBUG] Current wallet state:", {
        id: wallet.id,
        balance_paise: wallet.balance_paise,
        frozen_balance_paise: wallet.frozen_balance_paise,
        withdrawn_balance_paise: wallet.withdrawn_balance_paise
      });
      
      const newBalance = wallet.balance_paise + amountPaise;
      const newTotalBalance = newBalance + wallet.frozen_balance_paise + wallet.withdrawn_balance_paise;
      
      console.log("🔍 [DEBUG] New balance calculations:", {
        newBalance,
        newTotalBalance,
        amountToAdd: amountPaise
      });

      // Update wallet balance first
      console.log("🔍 [DEBUG] Updating wallet in database...");
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          total_balance_paise: newTotalBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
          updated_at: new Date().toISOString()
        })
        .eq("id", wallet.id);

      if (updateError) {
        console.error("❌ [DEBUG] Wallet update error:", updateError);
        throw updateError;
      }

      console.log("✅ [DEBUG] Wallet updated successfully");

      // Create transaction record
      console.log("🔍 [DEBUG] Creating transaction record...");
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "credit",
          direction: "credit",
          status: "completed",
          stage: "verified",
          razorpay_order_id: transactionData.razorpay_order_id,
          razorpay_payment_id: transactionData.razorpay_payment_id,
          conversation_id: transactionData.conversation_id,
          related_conversation_id: transactionData.conversation_id,
          notes: transactionData.notes,
          balance_after_paise: newBalance,
          frozen_balance_after_paise: wallet.frozen_balance_paise,
          withdrawn_balance_after_paise: wallet.withdrawn_balance_paise,
          // Track who sent and received the payment
          sender_id: transactionData.brand_owner_id,
          receiver_id: userId,
          // Link to conversation via bid_id or campaign_id
          ...(transactionData.bid_id ? 
            { bid_id: transactionData.bid_id } : 
            { campaign_id: transactionData.campaign_id }
          )
        })
        .select()
        .single();

      if (transactionError) {
        console.error("❌ [DEBUG] Transaction creation error:", transactionError);
        throw transactionError;
      }

      console.log("✅ [DEBUG] Transaction created successfully:", transaction.id);

      return {
        success: true,
        transaction,
        new_balance: newBalance,
        new_balance_rupees: newBalance / 100,
        new_total_balance: newTotalBalance,
        new_total_balance_rupees: newTotalBalance / 100,
      };
    } catch (error) {
      console.error("❌ [DEBUG] addFunds error:", error);
      console.error("❌ [DEBUG] Error stack:", error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process withdrawal from wallet
   */
  async processWithdrawal(userId, amountPaise, withdrawalData = {}) {
    try {
      const walletResult = await this.getWalletBalance(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      const wallet = walletResult.wallet;

      // Check if user has enough available balance
      if (wallet.balance_paise < amountPaise) {
        return {
          success: false,
          error: "Insufficient available balance for withdrawal",
          available_balance: wallet.balance_paise,
          requested_amount: amountPaise,
        };
      }

      const newBalance = wallet.balance_paise - amountPaise;
      const newWithdrawnBalance = wallet.withdrawn_balance_paise + amountPaise;
      const newTotalBalance = newBalance + wallet.frozen_balance_paise + newWithdrawnBalance;

      // Update wallet balances
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          withdrawn_balance_paise: newWithdrawnBalance,
          total_balance_paise: newTotalBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
          updated_at: new Date().toISOString()
        })
        .eq("id", wallet.id);

      if (updateError) {
        throw updateError;
      }

      // Generate withdrawal ID
      const withdrawalId = `withdraw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create withdrawal transaction record
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "debit",
          direction: "debit",
          status: "completed",
          stage: "verified",
          withdrawal_id: withdrawalId,
          notes: `Withdrawal processed - ID: ${withdrawalId}`,
          balance_after_paise: newBalance,
          frozen_balance_after_paise: wallet.frozen_balance_paise,
          withdrawn_balance_after_paise: newWithdrawnBalance,
          ...withdrawalData,
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      return {
        success: true,
        transaction,
        withdrawal_id: withdrawalId,
        new_balance: newBalance,
        new_balance_rupees: newBalance / 100,
        new_withdrawn_balance: newWithdrawnBalance,
        new_withdrawn_balance_rupees: newWithdrawnBalance / 100,
        new_total_balance: newTotalBalance,
        new_total_balance_rupees: newTotalBalance / 100,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Track brand owner payment (debit for brand owner)
   */
  async trackBrandOwnerPayment(brandOwnerId, amountPaise, conversationId, paymentData = {}) {
    try {
      // Get or create wallet for brand owner
      const walletResult = await this.getWalletBalance(brandOwnerId);
      if (!walletResult.success) {
        return walletResult;
      }

      const wallet = walletResult.wallet;

      // Create debit transaction record for brand owner
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: brandOwnerId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "debit",
          direction: "debit",
          status: "completed",
          stage: "verified",
          conversation_id: conversationId,
          related_conversation_id: conversationId,
          notes: `Payment sent for conversation ${conversationId}`,
          balance_after_paise: wallet.balance_paise,
          frozen_balance_after_paise: wallet.frozen_balance_paise,
          withdrawn_balance_after_paise: wallet.withdrawn_balance_paise,
          ...paymentData,
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      return {
        success: true,
        transaction,
        message: "Brand owner payment tracked successfully"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Freeze funds in escrow (move from available to frozen)
   */
  async freezeFunds(userId, amountPaise, escrowHoldId, transactionData = {}) {
    try {
      const walletResult = await this.getWalletBalance(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      const wallet = walletResult.wallet;

      // Check if user has enough available balance
      if (wallet.balance_paise < amountPaise) {
        return {
          success: false,
          error: "Insufficient available balance for escrow hold",
          available_balance: wallet.balance_paise,
          requested_amount: amountPaise,
        };
      }

      const newBalance = wallet.balance_paise - amountPaise;
      const newFrozenBalance = wallet.frozen_balance_paise + amountPaise;
      const newTotalBalance = newBalance + newFrozenBalance + wallet.withdrawn_balance_paise;

      // Update wallet balances
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          frozen_balance_paise: newFrozenBalance,
          total_balance_paise: newTotalBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
          updated_at: new Date().toISOString()
        })
        .eq("id", wallet.id);

      if (updateError) {
        throw updateError;
      }

      // Create freeze transaction record
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "debit",
          direction: "debit",
          status: "completed",
          stage: "escrow_hold",
          escrow_hold_id: escrowHoldId,
          related_escrow_hold_id: escrowHoldId,
          is_escrow_frozen: true,
          escrow_status: "active",
          notes: `Funds frozen in escrow (Hold ID: ${escrowHoldId})`,
          balance_after_paise: newBalance,
          frozen_balance_after_paise: newFrozenBalance,
          withdrawn_balance_after_paise: wallet.withdrawn_balance_paise,
          ...transactionData,
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      return {
        success: true,
        transaction,
        new_balance: newBalance,
        new_balance_rupees: newBalance / 100,
        new_frozen_balance: newFrozenBalance,
        new_frozen_balance_rupees: newFrozenBalance / 100,
        new_total_balance: newTotalBalance,
        new_total_balance_rupees: newTotalBalance / 100,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Release funds from escrow (move from frozen to available)
   */
  async releaseFunds(userId, amountPaise, escrowHoldId, transactionData = {}) {
    try {
      const walletResult = await this.getWalletBalance(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      const wallet = walletResult.wallet;

      // Check if user has enough frozen balance
      if (wallet.frozen_balance_paise < amountPaise) {
        return {
          success: false,
          error: "Insufficient frozen balance for release",
          frozen_balance: wallet.frozen_balance_paise,
          requested_amount: amountPaise,
        };
      }

      const newFrozenBalance = wallet.frozen_balance_paise - amountPaise;
      const newBalance = wallet.balance_paise + amountPaise;
      const newTotalBalance = newBalance + newFrozenBalance + wallet.withdrawn_balance_paise;

      // Update wallet balances
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          frozen_balance_paise: newFrozenBalance,
          total_balance_paise: newTotalBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
          updated_at: new Date().toISOString()
        })
        .eq("id", wallet.id);

      if (updateError) {
        throw updateError;
      }

      // Create release transaction record
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "credit",
          direction: "credit",
          status: "completed",
          stage: "escrow_release",
          escrow_hold_id: escrowHoldId,
          related_escrow_hold_id: escrowHoldId,
          is_escrow_frozen: false,
          escrow_status: "released",
          notes: `Funds released from escrow (Hold ID: ${escrowHoldId})`,
          balance_after_paise: newBalance,
          frozen_balance_after_paise: newFrozenBalance,
          withdrawn_balance_after_paise: wallet.withdrawn_balance_paise,
          ...transactionData,
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      return {
        success: true,
        transaction,
        new_balance: newBalance,
        new_balance_rupees: newBalance / 100,
        new_frozen_balance: newFrozenBalance,
        new_frozen_balance_rupees: newFrozenBalance / 100,
        new_total_balance: newTotalBalance,
        new_total_balance_rupees: newTotalBalance / 100,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive transaction history
   */
  async getTransactionHistory(userId, page = 1, limit = 20, filters = {}) {
    try {
      let query = supabaseAdmin
        .from("transaction_history_view")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters.type) {
        query = query.eq("type", filters.type);
      }
      if (filters.direction) {
        query = query.eq("direction", filters.direction);
      }
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.conversation_id) {
        query = query.eq("conversation_id", filters.conversation_id);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: transactions, error } = await query;

      if (error) {
        throw error;
      }

      return {
        success: true,
        transactions: transactions || [],
        pagination: {
          page,
          limit,
          has_more: transactions && transactions.length === limit
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transaction summary for a user
   */
  async getTransactionSummary(userId, days = 30) {
    try {
      const { data: summary, error } = await supabaseAdmin
        .rpc("get_transaction_summary", {
          user_id: userId,
          days: days
        });

      if (error) {
        throw error;
      }

      return {
        success: true,
        summary: summary[0] || {
          total_credits_paise: 0,
          total_debits_paise: 0,
          total_withdrawals_paise: 0,
          total_escrow_holds_paise: 0,
          total_escrow_releases_paise: 0,
          net_balance_change_paise: 0
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get escrow holds for a user
   */
  async getEscrowHolds(userId) {
    try {
      const { data: holds, error } = await supabaseAdmin
        .from("escrow_holds")
        .select(`
          *,
          conversations!inner (
            brand_owner_id,
            influencer_id,
            flow_state,
            conversation_type
          )
        `)
        .or(
          `conversations.brand_owner_id.eq.${userId},conversations.influencer_id.eq.${userId}`
        )
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return {
        success: true,
        holds: holds || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new EnhancedBalanceService();
