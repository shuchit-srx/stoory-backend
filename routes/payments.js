const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const { PaymentController } = require("../controllers/paymentController");
const { body } = require("express-validator");

// Protected payment routes
router.use(authService.authenticateToken);

// Process payment from frontend
router.post("/process-payment", PaymentController.processPayment);

// Request payment config (Razorpay key, currency)
router.get("/payment-config", PaymentController.getPaymentConfig);

// Create Razorpay order for request payments
router.post("/create-order", PaymentController.createOrderForRequest);
// Transaction management
router.get("/transactions", authService.authenticateToken, PaymentController.getTransactionHistory);
router.get("/wallet/balance", PaymentController.getWalletBalance);

router.post(
  "/wallet/withdraw",
  [body("amount").isNumeric().withMessage("Amount must be a number")],
  PaymentController.withdrawBalance
);

// Refund management
router.post("/refund", PaymentController.createRefund);

// Request payment details
router.get(
  "/request/:request_id/payment-details",
  PaymentController.getRequestPaymentDetails
);



module.exports = router;
