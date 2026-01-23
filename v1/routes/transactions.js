const express = require("express");
const router = express.Router();
const TransactionController = require("../controllers/transactionController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * Transaction Routes
 * All routes require authentication
 */

// Get my transactions
router.get(
  "/my",
  authMiddleware.authenticateToken,
  TransactionController.getMyTransactions
);

module.exports = router;

