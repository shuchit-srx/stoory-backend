const { validationResult } = require("express-validator");
const CampaignService = require("../services/campaignService");

class CampaignController {
  /**
   * Create a new campaign (Brand Owner only)
   * POST /api/v1/campaigns
   */
  async createCampaign(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const userId = req.user.id;
      const userRole = req.user.role;

      // Only brand owners can create campaigns
      if (userRole !== "BRAND") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can create campaigns",
        });
      }

      // Get brand_id from user (brand_id is the user_id for brand owners)
      const brandId = userId;

      const result = await CampaignService.createCampaign(brandId, req.body);

      if (result.success) {
        return res.status(201).json({
          success: true,
          campaign: result.campaign,
          message: result.message || "Campaign created successfully",
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/createCampaign] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get all campaigns with filtering and pagination
   * GET /api/v1/campaigns
   * - Influencers: See all campaigns
   * - Brand Owners: See all campaigns (can filter by brand_id)
   */
  async getCampaigns(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // Extract filters from query params
      const filters = {
        status: req.query.status,
        type: req.query.type,
        brand_id: req.query.brand_id,
        min_budget: req.query.min_budget
          ? parseFloat(req.query.min_budget)
          : undefined,
        max_budget: req.query.max_budget
          ? parseFloat(req.query.max_budget)
          : undefined,
        search: req.query.search,
      };

      // Remove undefined filters
      Object.keys(filters).forEach(
        (key) => filters[key] === undefined && delete filters[key]
      );

      // Extract pagination
      const pagination = {
        page: req.query.page ? parseInt(req.query.page) : 1,
        limit: req.query.limit ? parseInt(req.query.limit) : 20,
      };

      const result = await CampaignService.getCampaigns(filters, pagination);

      if (result.success) {
        return res.json({
          success: true,
          campaigns: result.campaigns,
          pagination: result.pagination,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/getCampaigns] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get campaigns created by authenticated brand owner
   * GET /api/v1/campaigns/my
   */
  async getMyCampaigns(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const userId = req.user.id;
      const userRole = req.user.role;

      // Only brand owners can see their own campaigns
      if (userRole !== "BRAND") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can view their campaigns",
        });
      }

      const brandId = userId;

      // Extract filters from query params
      const filters = {
        status: req.query.status,
        type: req.query.type,
        min_budget: req.query.min_budget
          ? parseFloat(req.query.min_budget)
          : undefined,
        max_budget: req.query.max_budget
          ? parseFloat(req.query.max_budget)
          : undefined,
        search: req.query.search,
      };

      // Remove undefined filters
      Object.keys(filters).forEach(
        (key) => filters[key] === undefined && delete filters[key]
      );

      // Extract pagination
      const pagination = {
        page: req.query.page ? parseInt(req.query.page) : 1,
        limit: req.query.limit ? parseInt(req.query.limit) : 20,
      };

      const result = await CampaignService.getBrandCampaigns(
        brandId,
        filters,
        pagination
      );

      if (result.success) {
        return res.json({
          success: true,
          campaigns: result.campaigns,
          pagination: result.pagination,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/getMyCampaigns] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get single campaign by ID
   * GET /api/v1/campaigns/:id
   */
  async getCampaign(req, res) {
    try {
      const campaignId = req.params.id;
      const userId = req.user?.id || null;

      const result = await CampaignService.getCampaignById(campaignId, userId);

      if (result.success) {
        return res.json({
          success: true,
          campaign: result.campaign,
        });
      }

      const status = result.message === "Campaign not found" ? 404 : 400;
      return res.status(status).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/getCampaign] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update campaign (Brand Owner only)
   * PUT /api/v1/campaigns/:id
   */
  async updateCampaign(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const userId = req.user.id;
      const userRole = req.user.role;
      const campaignId = req.params.id;

      // Only brand owners can update campaigns
      if (userRole !== "BRAND") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can update campaigns",
        });
      }

      const brandId = userId;

      const result = await CampaignService.updateCampaign(
        campaignId,
        brandId,
        req.body
      );

      if (result.success) {
        return res.json({
          success: true,
          campaign: result.campaign,
          message: result.message || "Campaign updated successfully",
        });
      }

      const status = result.message?.includes("Unauthorized") ? 403 : 400;
      return res.status(status).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/updateCampaign] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete campaign (Brand Owner only)
   * DELETE /api/v1/campaigns/:id
   */
  async deleteCampaign(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const campaignId = req.params.id;

      // Only brand owners can delete campaigns
      if (userRole !== "BRAND") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can delete campaigns",
        });
      }

      const brandId = userId;

      const result = await CampaignService.deleteCampaign(campaignId, brandId);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message || "Campaign deleted successfully",
        });
      }

      const status =
        result.message?.includes("Unauthorized") ||
        result.message === "Campaign not found"
          ? 404
          : 400;
      return res.status(status).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/deleteCampaign] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

module.exports = new CampaignController();
