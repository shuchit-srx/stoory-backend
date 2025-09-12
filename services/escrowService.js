const { supabaseAdmin } = require('../supabase/client');

class EscrowService {
  /**
   * Freeze payment amount in escrow
   */
  async freezePaymentAmount(conversationId, amount, reason = 'Payment held in escrow') {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      // Get influencer's wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('user_id', conversation.influencer_id)
        .single();

      if (walletError || !wallet) {
        throw new Error('Influencer wallet not found');
      }

      // Check if sufficient balance
      const availableBalance = (wallet.balance_paise || 0) - (wallet.frozen_balance_paise || 0);
      if (availableBalance < amount) {
        throw new Error('Insufficient balance for escrow hold');
      }

      // Update frozen balance
      const newFrozenBalance = (wallet.frozen_balance_paise || 0) + amount;
      const { error: updateError } = await supabaseAdmin
        .from('wallets')
        .update({
          frozen_balance_paise: newFrozenBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', wallet.id);

      if (updateError) {
        throw new Error(`Failed to freeze payment: ${updateError.message}`);
      }

      // Create escrow hold record
      const { data: escrowHold, error: escrowError } = await supabaseAdmin
        .from('escrow_holds')
        .insert({
          conversation_id: conversationId,
          amount_paise: amount,
          status: 'held',
          release_reason: reason,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (escrowError) {
        throw new Error(`Failed to create escrow hold: ${escrowError.message}`);
      }

      return {
        success: true,
        escrowHold,
        wallet: {
          id: wallet.id,
          balance_paise: wallet.balance_paise,
          frozen_balance_paise: newFrozenBalance
        }
      };
    } catch (error) {
      console.error('Error freezing payment amount:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Release escrow funds
   */
  async releaseEscrowFunds(conversationId, reason = 'Work approved by brand owner') {
    try {
      // Get escrow hold
      const { data: escrowHold, error: escrowError } = await supabaseAdmin
        .from('escrow_holds')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('status', 'held')
        .single();

      if (escrowError || !escrowHold) {
        throw new Error('No active escrow hold found');
      }

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      // Get influencer's wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('user_id', conversation.influencer_id)
        .single();

      if (walletError || !wallet) {
        throw new Error('Influencer wallet not found');
      }

      // Release frozen amount to available balance
      const currentFrozenBalance = wallet.frozen_balance_paise || 0;
      const currentAvailableBalance = wallet.balance_paise || 0;
      const releaseAmount = escrowHold.amount_paise;
      
      const newFrozenBalance = Math.max(0, currentFrozenBalance - releaseAmount);
      const newAvailableBalance = currentAvailableBalance + releaseAmount;
      
      const { error: updateError } = await supabaseAdmin
        .from('wallets')
        .update({
          frozen_balance_paise: newFrozenBalance,
          balance_paise: newAvailableBalance,
          balance: newAvailableBalance / 100, // Keep old balance field for compatibility
          updated_at: new Date().toISOString()
        })
        .eq('id', wallet.id);

      if (updateError) {
        throw new Error(`Failed to release escrow: ${updateError.message}`);
      }

      // Update escrow hold status
      const { error: escrowUpdateError } = await supabaseAdmin
        .from('escrow_holds')
        .update({
          status: 'released',
          release_reason: reason,
          released_at: new Date().toISOString()
        })
        .eq('id', escrowHold.id);

      if (escrowUpdateError) {
        throw new Error(`Failed to update escrow hold: ${escrowUpdateError.message}`);
      }

      // Create transaction record for escrow release
      const { error: transactionError } = await supabaseAdmin
        .from('transactions')
        .insert({
          wallet_id: wallet.id,
          user_id: conversation.influencer_id,
          amount: releaseAmount / 100, // compatibility
          amount_paise: releaseAmount,
          type: 'credit',
          direction: 'credit',
          status: 'completed',
          stage: 'escrow_release',
          notes: `Escrow funds released: ${reason}`
        });

      if (transactionError) {
        console.error('Transaction creation error for escrow release:', transactionError);
        // Don't fail the release, just log the error
      }

      return {
        success: true,
        released_amount: escrowHold.amount_paise,
        wallet: {
          id: wallet.id,
          balance_paise: newAvailableBalance,
          frozen_balance_paise: newFrozenBalance
        }
      };
    } catch (error) {
      console.error('Error releasing escrow funds:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process auto-release for escrow holds (cron job)
   */
  async processAutoRelease() {
    try {
      // Get escrow holds that should be auto-released (e.g., after 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: escrowHolds, error } = await supabaseAdmin
        .from('escrow_holds')
        .select('*')
        .eq('status', 'held')
        .lt('created_at', thirtyDaysAgo.toISOString());

      if (error) {
        throw new Error(`Failed to fetch escrow holds: ${error.message}`);
      }

      const results = {
        processed: 0,
        errors: 0,
        releases: []
      };

      for (const escrowHold of escrowHolds) {
        try {
          const releaseResult = await this.releaseEscrowFunds(
            escrowHold.conversation_id,
            'Auto-released after 30 days'
          );

          if (releaseResult.success) {
            results.releases.push({
              escrow_hold_id: escrowHold.id,
              conversation_id: escrowHold.conversation_id,
              amount: escrowHold.amount_paise
            });
          } else {
            results.errors++;
          }

          results.processed++;
        } catch (error) {
          console.error(`Error auto-releasing escrow hold ${escrowHold.id}:`, error);
          results.errors++;
        }
      }

      return {
        success: true,
        results
      };
    } catch (error) {
      console.error('Error processing auto-release:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get escrow status for a conversation
   */
  async getEscrowStatus(conversationId) {
    try {
      const { data: escrowHold, error } = await supabaseAdmin
        .from('escrow_holds')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch escrow status: ${error.message}`);
      }

      return {
        success: true,
        escrowHold: escrowHold || null
      };
    } catch (error) {
      console.error('Error getting escrow status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new EscrowService();
