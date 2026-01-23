const UserService = require("../services/userService");

/**
 * User Controller
 * Handles HTTP requests for user-related endpoints
 */
class UserController {
  /**
   * Get user details with all related data
   * GET /api/v1/users/me
   */
  async getUser(req, res) {
    try {
      const userId = req.user.id;

      const result = await UserService.getUser(userId);

      if (!result.success) {
        return res.status(result.statusCode || 404).json({
          success: false,
          message: result.message || "Failed to fetch user data",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error("[v1/UserController/getUser] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get influencers - handles both all influencers and single influencer by ID
   * GET /api/v1/users/influencers/all - Returns all influencers with pagination
   * GET /api/v1/users/influencers/:id - Returns a single influencer by ID
   * Requires BRAND_OWNER role
   */
  async getInfluencers(req, res) {
    try {
      const id = req.params.id;

      // If id is "all", return all influencers with pagination
      if (id === "all") {
        // Extract pagination with validation and limits - Using offset + limit for infinite scroll
        const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Max 100
        const offset = parseInt(req.query.offset) || 0;
        
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

        const pagination = {
          limit,
          offset,
        };

        const result = await UserService.getAllInfluencers(pagination);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch influencers",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
          message: "Influencers fetched successfully",
          influencers: result.influencers,
          pagination: result.pagination,
        });
      }

      // Otherwise, treat id as influencer ID and return single influencer
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Influencer ID is required",
        });
      }

      const result = await UserService.getInfluencerById(id);

      if (!result.success) {
        return res.status(404).json({
          success: false,
          message: result.message || "Influencer not found",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Influencer fetched successfully",
        influencer: result.influencer,
      });
    } catch (err) {
      console.error("[v1/UserController/getInfluencers] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new UserController();

