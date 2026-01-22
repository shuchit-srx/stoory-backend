const { supabaseAdmin } = require("../db/config");

/**
 * Transaction Service
 * Handles business logic for transaction operations
 */
class TransactionService {
  /**
   * Get transactions for the authenticated user
   * For non-admin users, includes transactions where admin is involved
   * @param {string} userId - User ID
   * @param {string} userRole - User role
   * @param {Object} filters - Query filters (type, status, limit, offset)
   * @returns {Promise<Object>} Result with transactions
   */
  async getMyTransactions(userId, userRole, filters = {}) {
    try {
      const { type, status, limit = 50, offset = 0 } = filters;

      // Build base query
      let query = supabaseAdmin
        .from("v1_transactions")
        .select(`
          *,
          v1_applications(
            id,
            phase,
            v1_campaigns(
              id,
              title,
              brand_id
            )
          )
        `)
        .order("created_at", { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      // Apply role-based filtering
      if (userRole === "ADMIN") {
        // Admin sees all transactions
        // No additional filter needed
      } else if (userRole === "BRAND_OWNER") {
        // Brand owner sees:
        // 1. Transactions where they are from_entity (their payments)
        // 2. Transactions where admin is from_entity (admin payouts - they can see admin activity)
        // First, get admin user IDs
        const { data: adminUsers } = await supabaseAdmin
          .from("v1_users")
          .select("id")
          .eq("role", "ADMIN")
          .eq("is_deleted", false);

        const adminIds = adminUsers?.map(u => u.id) || [];
        const allFromEntities = [userId, ...adminIds];

        query = query.in("from_entity", allFromEntities);
      } else if (userRole === "INFLUENCER") {
        // Influencer sees:
        // 1. Transactions where they are to_entity (their payouts)
        // 2. Transactions where admin is to_entity (admin payments - they can see admin activity)
        // First, get admin user IDs
        const { data: adminUsers } = await supabaseAdmin
          .from("v1_users")
          .select("id")
          .eq("role", "ADMIN")
          .eq("is_deleted", false);

        const adminIds = adminUsers?.map(u => u.id) || [];
        const allToEntities = [userId, ...adminIds];

        query = query.in("to_entity", allToEntities);
      } else {
        return {
          success: false,
          message: "Invalid user role",
        };
      }

      // Apply filters
      if (type) {
        query = query.eq("type", type);
      }
      if (status) {
        query = query.eq("status", status);
      }

      const { data: transactions, error, count } = await query;

      if (error) {
        console.error("[TransactionService/getMyTransactions] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch transactions",
          error: error.message,
        };
      }

      // Calculate totals: fetch all transactions where user is directly involved
      // Only count COMPLETED transactions for totals
      let totalsQuery = supabaseAdmin
        .from("v1_transactions")
        .select("from_entity, to_entity, gross_amount, net_amount, status")
        .eq("status", "COMPLETED")
        .or(`from_entity.eq.${userId},to_entity.eq.${userId}`); // User must be directly involved

      // Apply type filter if provided
      if (type) {
        totalsQuery = totalsQuery.eq("type", type);
      }

      const { data: allTransactions, error: totalsError } = await totalsQuery;

      if (totalsError) {
        console.error("[TransactionService/getMyTransactions] Totals query error:", totalsError);
      }

      // Calculate totals - only for transactions where user is directly involved
      let totalCredited = 0;
      let totalDebited = 0;

      if (allTransactions && allTransactions.length > 0) {
        allTransactions.forEach(txn => {
          // Credits: money coming TO the user
          if (txn.to_entity === userId) {
            totalCredited += parseFloat(txn.net_amount || 0);
          }
          // Debits: money going FROM the user
          if (txn.from_entity === userId) {
            totalDebited += parseFloat(txn.gross_amount || 0);
          }
        });
      }

      const netAmount = totalCredited - totalDebited;

      if (!transactions || transactions.length === 0) {
        return {
          success: true,
          message: "Transactions fetched successfully",
          transactions: [],
          summary: {
            total_credited: parseFloat(totalCredited.toFixed(2)),
            total_debited: parseFloat(totalDebited.toFixed(2)),
            net_amount: parseFloat(netAmount.toFixed(2)),
          },
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            count: 0,
          },
        };
      }

      // Get unique user IDs from transactions
      const userIds = new Set();
      transactions.forEach(txn => {
        if (txn.from_entity) userIds.add(txn.from_entity);
        if (txn.to_entity) userIds.add(txn.to_entity);
      });

      // Fetch user details
      const { data: users, error: usersError } = await supabaseAdmin
        .from("v1_users")
        .select("id, name, email")
        .in("id", Array.from(userIds))
        .eq("is_deleted", false);

      if (usersError) {
        console.error("[TransactionService/getMyTransactions] Users fetch error:", usersError);
      }

      // Create user map
      const userMap = {};
      (users || []).forEach(user => {
        userMap[user.id] = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      });

      // Format transactions with user details and rename v1_ prefixes
      const formattedTransactions = transactions.map(txn => {
        const formatted = {
          id: txn.id,
          application_id: txn.application_id,
          type: txn.type,
          from_entity: txn.from_entity,
          to_entity: txn.to_entity,
          gross_amount: txn.gross_amount,
          platform_fee: txn.platform_fee,
          net_amount: txn.net_amount,
          status: txn.status,
          created_at: txn.created_at,
          from_user: userMap[txn.from_entity] || null,
          to_user: userMap[txn.to_entity] || null,
        };

        // Format application data (rename v1_campaigns to campaign)
        if (txn.v1_applications) {
          const { v1_campaigns, ...applicationData } = txn.v1_applications;
          formatted.application = {
            ...applicationData,
            campaign: v1_campaigns || null,
          };
        } else {
          formatted.application = null;
        }

        return formatted;
      });

      return {
        success: true,
        message: "Transactions fetched successfully",
        transactions: formattedTransactions,
        summary: {
          total_credited: parseFloat(totalCredited.toFixed(2)),
          total_debited: parseFloat(totalDebited.toFixed(2)),
          net_amount: parseFloat(netAmount.toFixed(2)),
        },
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          count: formattedTransactions.length,
        },
      };
    } catch (err) {
      console.error("[TransactionService/getMyTransactions] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch transactions",
        error: err.message,
      };
    }
  }
}

module.exports = new TransactionService();

