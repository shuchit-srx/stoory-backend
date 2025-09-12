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
router.get("/transactions", PaymentController.getTransactionHistory);

// New escrow payment routes
router.post(
  "/process-final-payment",
  [
    body("razorpay_order_id")
      .notEmpty()
      .withMessage("RazorPay order ID is required"),
    body("razorpay_payment_id")
      .notEmpty()
      .withMessage("RazorPay payment ID is required"),
    body("razorpay_signature")
      .notEmpty()
      .withMessage("RazorPay signature is required"),
    body("request_id").isUUID().withMessage("Request ID must be a valid UUID"),
    body("amount").isNumeric().withMessage("Amount must be a number"),
  ],
  PaymentController.processFinalPayment
);

// Test payment endpoint (for testing only)
router.post(
  "/test-payment",
  [
    body("request_id").isUUID().withMessage("Request ID must be a valid UUID"),
    body("amount").isNumeric().withMessage("Amount must be a number"),
  ],
  PaymentController.testPayment
);

router.post("/unfreeze-payment/:request_id", PaymentController.unfreezePayment);

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

// Note: verifyAutomatedFlowPayment is handled in routes/bids.js

module.exports = router;
