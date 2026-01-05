const { validationResult } = require('express-validator');
const { ApplicationService } = require('../services');
const { supabaseAdmin } = require('../db/config');

class ApplicationController {

  /**
   * Helper method to get brand profile ID from user ID
   * Since v1_brand_profiles uses user_id as primary key, we just verify the profile exists
   */
  async getBrandProfileId(userId) {
    try {
      const { data: brandProfile, error } = await supabaseAdmin
        .from("v1_brand_profiles")
        .select("user_id")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (error) {
        console.error("[v1/getBrandProfileId] Error:", error);
        return { success: false, error: error.message };
      }

      if (!brandProfile) {
        return { success: false, error: "Brand profile not found" };
      }

      // v1_brand_profiles uses user_id as primary key, so brand_id = user_id
      return { success: true, brandId: userId };
    } catch (err) {
      console.error("[v1/getBrandProfileId] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  async apply(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const campaignId = req.body.campaignId;

      const result = await ApplicationService.apply({
        campaignId: campaignId,
        influencerId: req.user.id,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({
        message: err.message || 'Failed to apply to campaign',
      });
    }
  }

  async accept(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      
      // Get brand_id from brand profile (not user_id)
      const brandProfileResult = await this.getBrandProfileId(userId);
      if (!brandProfileResult || !brandProfileResult.success) {
        const errorMsg = brandProfileResult?.error || "Unknown error";
        const isNotFound = errorMsg.includes("not found");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({
          success: false,
          message: isNotFound
            ? "Brand profile not found. Please complete your profile first."
            : "Failed to fetch brand profile",
          error: errorMsg,
        });
      }

      const result = await ApplicationService.accept({
        applicationId: req.params.id,
        brandId: brandProfileResult.brandId,
        agreedAmount: req.body.agreedAmount,
        platformFeePercent: req.body.platformFeePercent,
        requiresScript: req.body.requiresScript,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({
        message: err.message || 'Failed to accept application',
      });
    }
  }

  async bulkAccept(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;

      // Get brand_id from brand profile
      const brandProfileResult = await this.getBrandProfileId(userId);
      if (!brandProfileResult || !brandProfileResult.success) {
        const errorMsg = brandProfileResult?.error || "Unknown error";
        const isNotFound = errorMsg.includes("not found");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({
          success: false,
          message: isNotFound
            ? "Brand profile not found. Please complete your profile first."
            : "Failed to fetch brand profile",
          error: errorMsg,
        });
      }

      const result = await ApplicationService.bulkAccept({
        campaignId: req.body.campaignId,
        applications: req.body.applications,
        brandId: brandProfileResult.brandId,
      });

      // Return 200 for full success, 207 for partial success
      const statusCode = result.success ? 200 : 207;
      return res.status(statusCode).json(result);
    } catch (err) {
      console.error('[ApplicationController/bulkAccept] Exception:', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Failed to bulk accept applications',
      });
    }
  }

  async cancel(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = req.user;
      
      // If user is a brand owner, get their brand profile ID
      let brandId = null;
      if (user.role === 'BRAND') {
        const brandProfileResult = await this.getBrandProfileId(user.id);
        if (!brandProfileResult || !brandProfileResult.success) {
          const errorMsg = brandProfileResult?.error || "Unknown error";
          const isNotFound = errorMsg.includes("not found");
          const status = isNotFound ? 404 : 500;
          return res.status(status).json({
            success: false,
            message: isNotFound
              ? "Brand profile not found. Please complete your profile first."
              : "Failed to fetch brand profile",
            error: errorMsg,
          });
        }
        brandId = brandProfileResult.brandId;
      }

      const result = await ApplicationService.cancel({
        applicationId: req.params.id,
        user: user,
        brandId: brandId,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({
        message: err.message || 'Failed to cancel application',
      });
    }
  }

  async complete(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const result = await ApplicationService.complete(req.params.id);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({
        message: err.message || 'Failed to complete application',
      });
    }
  }
}

// Create instance and bind methods to preserve 'this' context
const applicationController = new ApplicationController();
applicationController.apply = applicationController.apply.bind(applicationController);
applicationController.accept = applicationController.accept.bind(applicationController);
applicationController.bulkAccept = applicationController.bulkAccept.bind(applicationController);
applicationController.cancel = applicationController.cancel.bind(applicationController);
applicationController.complete = applicationController.complete.bind(applicationController);

module.exports = applicationController;