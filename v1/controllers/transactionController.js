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
      
      // Standardized pagination - Default limit 20, max 100
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;
      const { type, status } = req.query;

      // Validate pagination
      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid limit. Must be >= 1",
        });
      }

      if (isNaN(offset) || offset < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offset. Must be >= 0",
        });
      }

      const result = await TransactionService.getMyTransactions(userId, userRole, {
        type,
        status,
        limit,
        offset,
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

