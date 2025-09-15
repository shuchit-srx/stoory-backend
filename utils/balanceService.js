const { supabaseAdmin } = require("../supabase/client");

class BalanceService {
  /**
   * Get user's wallet balance with proper breakdown
   */
  async getWalletBalance(userId) {
    try {
      const { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // Wallet doesn't exist, create one
          return await this.createWallet(userId);
        }
        throw error;
      }

      return {
        success: true,
        wallet: {
          id: wallet.id,
          user_id: wallet.user_id,
          balance: wallet.balance || 0,
          balance_paise: wallet.balance_paise || 0,
          frozen_balance_paise: wallet.frozen_balance_paise || 0,
          available_balance:
            (wallet.balance_paise || 0) - (wallet.frozen_balance_paise || 0),
          available_balance_rupees:
            ((wallet.balance_paise || 0) - (wallet.frozen_balance_paise || 0)) /
            100,
          frozen_balance_rupees: (wallet.frozen_balance_paise || 0) / 100,
          total_balance_rupees: (wallet.balance_paise || 0) / 100,
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
   * Create a new wallet for user
   */
  async createWallet(userId) {
    try {
      const { data: wallet, error } = await supabaseAdmin
        .from("wallets")
        .insert({
          user_id: userId,
          balance: 0.0,
          balance_paise: 0,
          frozen_balance_paise: 0,
        })
        .select()
        .single();

      if (error) {
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
          available_balance: 0,
          available_balance_rupees: 0,
          frozen_balance_rupees: 0,
          total_balance_rupees: 0,
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
   * Add funds to wallet (for payments received)
   */
  async addFunds(userId, amountPaise, transactionData = {}) {
    try {
      // Get or create wallet
      const walletResult = await this.getWalletBalance(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      const wallet = walletResult.wallet;
      const newBalance = wallet.balance_paise + amountPaise;

      // Update wallet balance
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
        })
        .eq("id", wallet.id);

      if (updateError) {
        throw updateError;
      }

      // Create transaction record
      const { data: transaction, error: transactionError } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          amount: amountPaise / 100,
          amount_paise: amountPaise,
          type: "credit",
          status: "completed",
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
      const availableBalance =
        wallet.balance_paise - wallet.frozen_balance_paise;
      if (availableBalance < amountPaise) {
        return {
          success: false,
          error: "Insufficient available balance",
          available_balance: availableBalance,
          requested_amount: amountPaise,
        };
      }

      const newFrozenBalance = wallet.frozen_balance_paise + amountPaise;

      // Update wallet frozen balance
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          frozen_balance_paise: newFrozenBalance,
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
          type: "freeze",
          status: "completed",
          escrow_hold_id: escrowHoldId,
          notes: `Funds frozen in escrow (Hold ID: ${escrowHoldId})`,
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
        new_frozen_balance: newFrozenBalance,
        new_frozen_balance_rupees: newFrozenBalance / 100,
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
          error: "Insufficient frozen balance",
          frozen_balance: wallet.frozen_balance_paise,
          requested_amount: amountPaise,
        };
      }

      const newFrozenBalance = wallet.frozen_balance_paise - amountPaise;

      // Update wallet frozen balance
      const { error: updateError } = await supabaseAdmin
        .from("wallets")
        .update({
          frozen_balance_paise: newFrozenBalance,
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
          type: "unfreeze",
          status: "completed",
          escrow_hold_id: escrowHoldId,
          notes: `Funds released from escrow (Hold ID: ${escrowHoldId})`,
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
        new_frozen_balance: newFrozenBalance,
        new_frozen_balance_rupees: newFrozenBalance / 100,
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
        .select(
          `
          *,
          conversations!inner (
            brand_owner_id,
            influencer_id
          )
        `
        )
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

  /**
   * Create escrow hold
   */
  async createEscrowHold(
    conversationId,
    paymentOrderId,
    amountPaise,
    reason = "Payment held in escrow"
  ) {
    try {
      const { data: escrowHold, error } = await supabaseAdmin
        .from("escrow_holds")
        .insert({
          conversation_id: conversationId,
          payment_order_id: paymentOrderId,
          amount_paise: amountPaise,
          status: "held",
          release_reason: reason,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        success: true,
        escrow_hold: escrowHold,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Release escrow hold
   */
  async releaseEscrowHold(
    escrowHoldId,
    reason = "Work completed successfully"
  ) {
    try {
      const { data: escrowHold, error } = await supabaseAdmin
        .from("escrow_holds")
        .update({
          status: "released",
          release_reason: reason,
          released_at: new Date().toISOString(),
        })
        .eq("id", escrowHoldId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        success: true,
        escrow_hold: escrowHold,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new BalanceService();
