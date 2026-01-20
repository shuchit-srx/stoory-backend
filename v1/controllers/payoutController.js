const PayoutService = require('../services/payoutService');

class PayoutController {
  /**
   * Create payment order for payout (Admin only)
   * Admin creates Razorpay order to pay for the payout
   * POST /api/v1/payouts/:payoutId/pay
   */
  async createPayoutPaymentOrder(req, res) {
    try {
      const { payoutId } = req.params;
      const adminId = req.user.id;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only admins can pay payouts',
        });
      }

      const result = await PayoutService.createPayoutPaymentOrder(payoutId, adminId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/createPayoutPaymentOrder] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to create payout payment order',
      });
    }
  }

  /**
   * Verify payout payment (Admin only)
   * Admin verifies the Razorpay payment after completing checkout
   * POST /api/v1/payouts/pay/verify
   */
  async verifyPayoutPayment(req, res) {
    try {
      const adminId = req.user.id;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only admins can verify payout payments',
        });
      }

      const result = await PayoutService.verifyPayoutPayment(req.body, adminId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/verifyPayoutPayment] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to verify payout payment',
      });
    }
  }

  /**
   * Get payout status
   * GET /api/v1/payouts/:payoutId
   */
  async getPayoutStatus(req, res) {
    try {
      const { payoutId } = req.params;
      const result = await PayoutService.getPayoutStatus(payoutId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/getPayoutStatus] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to get payout status',
      });
    }
  }

  /**
   * Get payouts for an application
   * GET /api/v1/payouts/application/:applicationId
   */
  async getApplicationPayouts(req, res) {
    try {
      const { applicationId } = req.params;
      const result = await PayoutService.getApplicationPayouts(applicationId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/getApplicationPayouts] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to get payouts',
      });
    }
  }

  /**
   * Get all pending payouts (Admin only)
   * GET /api/v1/payouts/pending
   */
  async getPendingPayouts(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only admins can view pending payouts',
        });
      }

      const result = await PayoutService.getPendingPayouts();

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/getPendingPayouts] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to get pending payouts',
      });
    }
  }
}

module.exports = new PayoutController();

