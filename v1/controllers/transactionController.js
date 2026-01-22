const TransactionService = require("../services/transactionService");

/**
 * Transaction Controller
 * Handles HTTP requests for transaction-related endpoints
 */
class TransactionController {
  /**
   * Get my transactions
   * GET /api/v1/transactions/my
   */
  async getMyTransactions(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { type, status, limit, offset } = req.query;

      const result = await TransactionService.getMyTransactions(userId, userRole, {
        type,
        status,
        limit: limit || 50,
        offset: offset || 0,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch transactions",
          error: result.error,
        });
      }

      return res.status(200).json(result);
    } catch (err) {
      console.error("[TransactionController/getMyTransactions] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new TransactionController();

