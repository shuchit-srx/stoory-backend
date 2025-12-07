const { supabaseAdmin } = require('../supabase/client');
const enhancedBalanceService = require('../utils/enhancedBalanceService');

class AdminWalletController {
  /**
   * Verify admin role
   */
  verifyAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    next();
  }

  /**
   * Get all transactions (admin only)
   * Query params: page, limit, type, direction, status, user_id, date_from, date_to, search
   */
  async getAllTransactions(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const type = req.query.type;
      const direction = req.query.direction;
      const status = req.query.status;
      const userId = req.user.id;
      console.log(userId);
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;
      const search = req.query.search;

      // Build query
      let query = supabaseAdmin
        .from('transactions')
        .select(`
          *,
          wallets!inner (
            user_id,
            users!inner (
              id,
              name,
              phone,
              email,
              role
            )
          ),
          campaigns (
            id,
            title,
            campaign_type
          ),
          bids (
            id,
            title
          ),
          conversations (
            id,
            conversation_type
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply filters
      if (type) {
        query = query.eq('type', type);
      }
      if (direction) {
        query = query.eq('direction', direction);
      }
      if (status) {
        query = query.eq('status', status);
      }
      if (dateFrom) {
        query = query.gte('created_at', dateFrom);
      }
      if (dateTo) {
        query = query.lte('created_at', dateTo);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: transactions, error, count } = await query;

      if (error) {
        throw error;
      }

      // Apply search filter if provided (search by user name, phone, email, or transaction ID)
      let filteredTransactions = transactions || [];
      if (search) {
        const searchLower = search.toLowerCase();
        filteredTransactions = filteredTransactions.filter(t => {
          const wallet = Array.isArray(t.wallets) ? t.wallets[0] : t.wallets;
          const user = wallet?.users ? (Array.isArray(wallet.users) ? wallet.users[0] : wallet.users) : null;
          const transactionId = t.id?.toLowerCase() || '';
          const razorpayId = (t.razorpay_payment_id || '').toLowerCase();
          const notes = (t.notes || '').toLowerCase();

          return (
            (user?.name?.toLowerCase().includes(searchLower)) ||
            (user?.phone?.toLowerCase().includes(searchLower)) ||
            (user?.email?.toLowerCase().includes(searchLower)) ||
            transactionId.includes(searchLower) ||
            razorpayId.includes(searchLower) ||
            notes.includes(searchLower)
          );
        });
      }

      // Format transactions for response
      const formattedTransactions = filteredTransactions.map(t => {
        // Handle nested user data - wallets is an array, get first element
        const wallet = Array.isArray(t.wallets) ? t.wallets[0] : t.wallets;
        const user = wallet?.users ? (Array.isArray(wallet.users) ? wallet.users[0] : wallet.users) : null;

        return {
          id: t.id,
          transaction_id: t.razorpay_payment_id || t.id,
          amount: t.amount,
          amount_paise: t.amount_paise,
          type: t.type,
          direction: t.direction,
          status: t.status,
          stage: t.stage,
          created_at: t.created_at,
          user: user ? {
            id: user.id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            role: user.role
          } : null,
          campaign: t.campaigns ? (Array.isArray(t.campaigns) ? t.campaigns[0] : t.campaigns) : null,
          conversation: t.conversations ? (Array.isArray(t.conversations) ? t.conversations[0] : t.conversations) : null,
          razorpay_order_id: t.razorpay_order_id,
          razorpay_payment_id: t.razorpay_payment_id,
          notes: t.notes
        };
      }).map(t => ({
        ...t,
        campaign: t.campaign ? {
          id: t.campaign.id,
          title: t.campaign.title,
          type: t.campaign.campaign_type
        } : null,
        conversation: t.conversation ? {
          id: t.conversation.id,
          type: t.conversation.conversation_type
        } : null
      }));

      res.json({
        success: true,
        transactions: formattedTransactions,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        },
        filters: {
          type: type || null,
          direction: direction || null,
          status: status || null,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          search: search || null
        }
      });
    } catch (error) {
      console.error('Error getting all transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get single transaction details (admin only)
   */
  async getTransactionDetails(req, res) {
    try {
      const { id } = req.params;

      const { data: transaction, error } = await supabaseAdmin
        .from('transactions')
        .select(`
          *,
          wallets!inner (
            user_id,
            users (
              id,
              name,
              phone,
              email,
              role
            )
          ),
          campaigns (
            id,
            title,
            campaign_type,
            created_by
          ),
          conversations (
            id,
            conversation_type,
            brand_owner_id,
            influencer_id
          )
        `)
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Transaction not found'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          amount_paise: transaction.amount_paise,
          type: transaction.type,
          direction: transaction.direction,
          status: transaction.status,
          stage: transaction.stage,
          created_at: transaction.created_at,
          user: (() => {
            const wallet = Array.isArray(transaction.wallets) ? transaction.wallets[0] : transaction.wallets;
            const user = wallet?.users ? (Array.isArray(wallet.users) ? wallet.users[0] : wallet.users) : null;
            return user ? {
              id: user.id,
              name: user.name,
              phone: user.phone,
              email: user.email,
              role: user.role
            } : null;
          })(),
          campaign: (() => {
            const campaign = transaction.campaigns ? (Array.isArray(transaction.campaigns) ? transaction.campaigns[0] : transaction.campaigns) : null;
            return campaign ? {
              id: campaign.id,
              title: campaign.title,
              type: campaign.campaign_type,
              created_by: campaign.created_by
            } : null;
          })(),

          conversation: (() => {
            const conversation = transaction.conversations ? (Array.isArray(transaction.conversations) ? transaction.conversations[0] : transaction.conversations) : null;
            return conversation ? {
              id: conversation.id,
              type: conversation.conversation_type,
              brand_owner_id: conversation.brand_owner_id,
              influencer_id: conversation.influencer_id
            } : null;
          })(),
          razorpay_order_id: transaction.razorpay_order_id,
          razorpay_payment_id: transaction.razorpay_payment_id,
          notes: transaction.notes,
          request_id: transaction.request_id,
          conversation_id: transaction.conversation_id
        }
      });
    } catch (error) {
      console.error('Error getting transaction details:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get all users with wallet balances (admin only)
   * Query params: page, limit, role, search
   */
  async getAllUsersWithWallets(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const role = req.query.role;
      const search = req.query.search;

      // Build query
      let query = supabaseAdmin
        .from('wallets')
        .select(`
          *,
          users!inner (
            id,
            name,
            phone,
            email,
            role
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply role filter
      if (role) {
        query = query.eq('users.role', role);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: wallets, error, count } = await query;

      if (error) {
        throw error;
      }

      // Apply search filter if provided
      let filteredWallets = wallets || [];
      if (search) {
        const searchLower = search.toLowerCase();
        filteredWallets = filteredWallets.filter(w => {
          const user = w.users ? (Array.isArray(w.users) ? w.users[0] : w.users) : null;
          return (
            (user?.name?.toLowerCase().includes(searchLower)) ||
            (user?.phone?.toLowerCase().includes(searchLower)) ||
            (user?.email?.toLowerCase().includes(searchLower))
          );
        });
      }

      // Format wallets for response
      const formattedWallets = filteredWallets.map(w => {
        const user = w.users ? (Array.isArray(w.users) ? w.users[0] : w.users) : null;
        return {
          wallet_id: w.id,
          user: user ? {
            id: user.id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            role: user.role
          } : null,
          balance: {
            available: w.balance_paise || 0,
            available_rupees: (w.balance_paise || 0) / 100,
            frozen: w.frozen_balance_paise || 0,
            frozen_rupees: (w.frozen_balance_paise || 0) / 100,
            withdrawn: w.withdrawn_balance_paise || 0,
            withdrawn_rupees: (w.withdrawn_balance_paise || 0) / 100,
            total: w.total_balance_paise || (w.balance_paise || 0) + (w.frozen_balance_paise || 0) + (w.withdrawn_balance_paise || 0),
            total_rupees: ((w.total_balance_paise || (w.balance_paise || 0) + (w.frozen_balance_paise || 0) + (w.withdrawn_balance_paise || 0)) / 100)
          },
          created_at: w.created_at,
          updated_at: w.updated_at
        };
      });

      res.json({
        success: true,
        users: formattedWallets,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        },
        filters: {
          role: role || null,
          search: search || null
        }
      });
    } catch (error) {
      console.error('Error getting all users with wallets:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get specific user's wallet details (admin only)
   */
  async getUserWalletDetails(req, res) {
    try {
      const { userId } = req.params;

      // Get wallet balance
      const balanceResult = await enhancedBalanceService.getWalletBalance(userId);
      if (!balanceResult.success) {
        return res.status(404).json({
          success: false,
          message: balanceResult.error || 'User wallet not found'
        });
      }

      // Get transaction summary
      const summaryResult = await enhancedBalanceService.getTransactionSummary(userId, 30);

      // Get recent transactions
      const historyResult = await enhancedBalanceService.getTransactionHistory(userId, 1, 10);

      // Get user details
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, name, phone, email, role')
        .eq('id', userId)
        .single();

      if (userError) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role
        },
        wallet: balanceResult.wallet,
        balance_summary: balanceResult.balance_summary,
        transaction_summary: summaryResult.success ? summaryResult.summary : null,
        recent_transactions: historyResult.success ? historyResult.transactions : []
      });
    } catch (error) {
      console.error('Error getting user wallet details:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get revenue breakdown by type (admin only)
   * Query params: date_from, date_to, days (default: 30)
   */
  async getRevenueBreakdown(req, res) {
    try {
      const days = parseInt(req.query.days) || 30;
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;

      // Calculate date range
      let startDate, endDate;
      if (dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
      }

      // Get all transactions in date range
      let query = supabaseAdmin
        .from('transactions')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const { data: transactions, error } = await query;

      if (error) {
        throw error;
      }

      // Categorize transactions
      let subscriptions = 0;
      let campaignPayments = 0;
      let payouts = 0;
      let refunds = 0;
      let gatewayFees = 0;

      transactions.forEach(t => {
        const amountPaise = t.amount_paise || Math.round((t.amount || 0) * 100);

        // Categorize based on transaction type and direction
        if (t.stage === 'refund' || t.type === 'refund') {
          refunds += amountPaise;
        } else if (t.type === 'withdrawal' && t.direction === 'debit') {
          payouts += amountPaise;
        } else if (t.campaign_id) {
          // Campaign payments
          if (t.direction === 'credit') {
            campaignPayments += amountPaise;
          }
        } else if (t.notes && t.notes.toLowerCase().includes('subscription')) {
          subscriptions += amountPaise;
        }
        // Gateway fees would need to be tracked separately or calculated
        // For now, we'll leave it as 0 or calculate from notes
      });

      const totalRevenue = subscriptions + campaignPayments;
      const totalExpenses = payouts + refunds + gatewayFees;
      const netProfit = totalRevenue - totalExpenses;

      res.json({
        success: true,
        period: dateFrom && dateTo
          ? `${dateFrom} to ${dateTo}`
          : `Last ${days} days`,
        date_from: startDate.toISOString(),
        date_to: endDate.toISOString(),
        revenue: {
          subscriptions: subscriptions / 100,
          subscriptions_paise: subscriptions,
          campaign_payments: campaignPayments / 100,
          campaign_payments_paise: campaignPayments,
          total_revenue: totalRevenue / 100,
          total_revenue_paise: totalRevenue
        },
        expenses: {
          payouts: payouts / 100,
          payouts_paise: payouts,
          refunds: refunds / 100,
          refunds_paise: refunds,
          gateway_fees: gatewayFees / 100,
          gateway_fees_paise: gatewayFees,
          total_expenses: totalExpenses / 100,
          total_expenses_paise: totalExpenses
        },
        net_profit: netProfit / 100,
        net_profit_paise: netProfit
      });
    } catch (error) {
      console.error('Error getting revenue breakdown:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get platform-wide statistics (admin only)
   * Query params: date_from, date_to, days (default: 30)
   */
  async getPlatformStatistics(req, res) {
    try {
      const days = parseInt(req.query.days) || 30;
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;

      // Calculate date range
      let startDate, endDate;
      if (dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
      }

      // Get all wallet balances
      const { data: wallets, error: walletsError } = await supabaseAdmin
        .from('wallets')
        .select('balance_paise, frozen_balance_paise, withdrawn_balance_paise, total_balance_paise');

      if (walletsError) {
        throw walletsError;
      }

      // Calculate platform totals
      let totalBalance = 0;
      let availableBalance = 0;
      let frozenBalance = 0;
      let withdrawnBalance = 0;

      wallets.forEach(w => {
        totalBalance += w.total_balance_paise || 0;
        availableBalance += w.balance_paise || 0;
        frozenBalance += w.frozen_balance_paise || 0;
        withdrawnBalance += w.withdrawn_balance_paise || 0;
      });

      // Get transaction statistics
      let transactionQuery = supabaseAdmin
        .from('transactions')
        .select('status, amount_paise, amount', { count: 'exact' })
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const { data: transactions, error: transactionsError, count: totalTransactions } = await transactionQuery;

      if (transactionsError) {
        throw transactionsError;
      }

      // Calculate transaction stats
      let pendingTransactions = 0;
      let completedTransactions = 0;
      let failedTransactions = 0;
      let pendingAmount = 0;
      let failedAmount = 0;

      transactions.forEach(t => {
        const amountPaise = t.amount_paise || Math.round((t.amount || 0) * 100);

        if (t.status === 'pending') {
          pendingTransactions++;
          pendingAmount += amountPaise;
        } else if (t.status === 'completed') {
          completedTransactions++;
        } else if (t.status === 'failed') {
          failedTransactions++;
          failedAmount += amountPaise;
        }
      });

      res.json({
        success: true,
        period: dateFrom && dateTo
          ? `${dateFrom} to ${dateTo}`
          : `Last ${days} days`,
        date_from: startDate.toISOString(),
        date_to: endDate.toISOString(),
        platform_balance: {
          total_balance: totalBalance / 100,
          total_balance_paise: totalBalance,
          available_balance: availableBalance / 100,
          available_balance_paise: availableBalance,
          frozen_balance: frozenBalance / 100,
          frozen_balance_paise: frozenBalance,
          withdrawn_balance: withdrawnBalance / 100,
          withdrawn_balance_paise: withdrawnBalance
        },
        transactions: {
          total_transactions: totalTransactions || 0,
          pending_transactions: pendingTransactions,
          completed_transactions: completedTransactions,
          failed_transactions: failedTransactions,
          pending_amount: pendingAmount / 100,
          pending_amount_paise: pendingAmount,
          failed_amount: failedAmount / 100,
          failed_amount_paise: failedAmount
        }
      });
    } catch (error) {
      console.error('Error getting platform statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get platform balance summary (admin only)
   */
  async getPlatformBalance(req, res) {
    try {
      // Get all wallet balances
      const { data: wallets, error: walletsError } = await supabaseAdmin
        .from('wallets')
        .select('balance_paise, frozen_balance_paise, withdrawn_balance_paise, total_balance_paise');

      if (walletsError) {
        throw walletsError;
      }

      // Calculate platform totals
      let totalBalance = 0;
      let availableBalance = 0;
      let frozenBalance = 0;
      let withdrawnBalance = 0;

      wallets.forEach(w => {
        totalBalance += w.total_balance_paise || 0;
        availableBalance += w.balance_paise || 0;
        frozenBalance += w.frozen_balance_paise || 0;
        withdrawnBalance += w.withdrawn_balance_paise || 0;
      });

      // Get pending transactions amount
      const { data: pendingTransactions, error: pendingError } = await supabaseAdmin
        .from('transactions')
        .select('amount_paise, amount')
        .eq('status', 'pending');

      if (pendingError) {
        throw pendingError;
      }

      let pendingAmount = 0;
      pendingTransactions.forEach(t => {
        pendingAmount += t.amount_paise || Math.round((t.amount || 0) * 100);
      });

      res.json({
        success: true,
        platform_available: availableBalance / 100,
        platform_available_paise: availableBalance,
        platform_pending: pendingAmount / 100,
        platform_pending_paise: pendingAmount,
        platform_frozen: frozenBalance / 100,
        platform_frozen_paise: frozenBalance,
        total_balance: totalBalance / 100,
        total_balance_paise: totalBalance
      });
    } catch (error) {
      console.error('Error getting platform balance:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  /**
   * Get transaction analytics (admin only)
   * Query params: period (daily/weekly/monthly), date_from, date_to
   */
  async getTransactionAnalytics(req, res) {
    try {
      const period = req.query.period || 'daily'; // daily, weekly, monthly
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;

      // Calculate date range
      let startDate, endDate;
      if (dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = new Date();
        startDate = new Date();
        // Default to last 30 days
        startDate.setDate(startDate.getDate() - 30);
      }

      // Get all transactions in date range
      const { data: transactions, error } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      // Group transactions by period
      const grouped = {};
      const typeBreakdown = {};
      const statusBreakdown = {};

      transactions.forEach(t => {
        const date = new Date(t.created_at);
        let key;

        if (period === 'daily') {
          key = date.toISOString().split('T')[0]; // YYYY-MM-DD
        } else if (period === 'weekly') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (period === 'monthly') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        if (!grouped[key]) {
          grouped[key] = {
            date: key,
            count: 0,
            total_amount_paise: 0,
            credits_paise: 0,
            debits_paise: 0
          };
        }

        const amountPaise = t.amount_paise || Math.round((t.amount || 0) * 100);
        grouped[key].count++;
        grouped[key].total_amount_paise += amountPaise;

        if (t.direction === 'credit') {
          grouped[key].credits_paise += amountPaise;
        } else if (t.direction === 'debit') {
          grouped[key].debits_paise += amountPaise;
        }

        // Type breakdown
        const type = t.type || 'unknown';
        if (!typeBreakdown[type]) {
          typeBreakdown[type] = { count: 0, total_paise: 0 };
        }
        typeBreakdown[type].count++;
        typeBreakdown[type].total_paise += amountPaise;

        // Status breakdown
        const status = t.status || 'unknown';
        if (!statusBreakdown[status]) {
          statusBreakdown[status] = { count: 0, total_paise: 0 };
        }
        statusBreakdown[status].count++;
        statusBreakdown[status].total_paise += amountPaise;
      });

      // Convert to array and format
      const trends = Object.values(grouped).map(g => ({
        date: g.date,
        count: g.count,
        total_amount: g.total_amount_paise / 100,
        total_amount_paise: g.total_amount_paise,
        credits: g.credits_paise / 100,
        credits_paise: g.credits_paise,
        debits: g.debits_paise / 100,
        debits_paise: g.debits_paise
      }));

      // Calculate growth (compare first and last period)
      let growthPercentage = 0;
      if (trends.length >= 2) {
        const first = trends[0].total_amount_paise;
        const last = trends[trends.length - 1].total_amount_paise;
        if (first > 0) {
          growthPercentage = ((last - first) / first) * 100;
        }
      }

      // Format breakdowns
      const formattedTypeBreakdown = Object.entries(typeBreakdown).map(([type, data]) => ({
        type,
        count: data.count,
        total: data.total_paise / 100,
        total_paise: data.total_paise
      }));

      const formattedStatusBreakdown = Object.entries(statusBreakdown).map(([status, data]) => ({
        status,
        count: data.count,
        total: data.total_paise / 100,
        total_paise: data.total_paise
      }));

      res.json({
        success: true,
        period,
        date_from: startDate.toISOString(),
        date_to: endDate.toISOString(),
        trends,
        growth_percentage: growthPercentage,
        type_breakdown: formattedTypeBreakdown,
        status_breakdown: formattedStatusBreakdown,
        summary: {
          total_transactions: transactions.length,
          total_amount: trends.reduce((sum, t) => sum + t.total_amount_paise, 0) / 100,
          total_amount_paise: trends.reduce((sum, t) => sum + t.total_amount_paise, 0),
          total_credits: trends.reduce((sum, t) => sum + t.credits_paise, 0) / 100,
          total_credits_paise: trends.reduce((sum, t) => sum + t.credits_paise, 0),
          total_debits: trends.reduce((sum, t) => sum + t.debits_paise, 0) / 100,
          total_debits_paise: trends.reduce((sum, t) => sum + t.debits_paise, 0)
        }
      });
    } catch (error) {
      console.error('Error getting transaction analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new AdminWalletController();

