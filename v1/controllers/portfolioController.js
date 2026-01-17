const { validationResult } = require("express-validator");
const PortfolioService = require("../services/portfolioService");

/**
 * Portfolio Controller
 * Handles HTTP requests for portfolio-related endpoints
 */
class PortfolioController {
  /**
   * Create a new portfolio item (Influencer only)
   * POST /api/v1/portfolios
   */
  async createPortfolioItem(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const userId = req.user.id;
      
      // Prepare portfolio data - include file uploads if present
      const portfolioData = {
        ...req.body,
        media_file: req.files?.media_file?.[0] || null,
        thumbnail_file: req.files?.thumbnail_file?.[0] || null,
      };
      
      const result = await PortfolioService.createPortfolioItem(userId, portfolioData);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          message: result.message || "Failed to create portfolio item",
          error: result.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message || "Portfolio item created successfully",
        portfolio: result.portfolio,
      });
    } catch (err) {
      console.error("[v1/PortfolioController/createPortfolioItem] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get portfolio items
   * GET /api/v1/portfolios
   * - Influencers: Can see their own portfolio (or filtered by user_id if it's their own)
   * - Brand Owners: Can see all portfolios (can filter by user_id)
   * - Admins: Can see all portfolios (can filter by user_id)
   */
  async getPortfolioItems(req, res) {
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
        user_id: req.query.user_id,
        media_type: req.query.media_type,
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

      const requesterRole = req.user.role;
      const requesterId = req.user.id;

      const result = await PortfolioService.getPortfolioItems(
        filters,
        pagination,
        requesterRole,
        requesterId
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          message: result.message || "Failed to fetch portfolio items",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        portfolios: result.portfolios,
        pagination: result.pagination,
      });
    } catch (err) {
      console.error("[v1/PortfolioController/getPortfolioItems] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new PortfolioController();

