const PayoutService = require('../services/payoutService');

class PayoutController {
  /**
   * Release payout to influencer (Admin only)
   * UPI ID is automatically fetched from v1_users table
   * POST /api/v1/payouts/:payoutId/release
   */
  async releasePayout(req, res) {
    try {
      const { payoutId } = req.params;
      const adminId = req.user.id;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only admins can release payouts',
        });
      }

      const result = await PayoutService.releasePayout(payoutId, adminId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[PayoutController/releasePayout] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to release payout',
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

