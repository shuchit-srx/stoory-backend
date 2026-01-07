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
   * Get all influencers
   * GET /api/v1/users/influencers
   * Requires BRAND_OWNER role
   */
  async getInfluencers(req, res) {
    try {
      const result = await UserService.getAllInfluencers();

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message || "Failed to fetch influencers",
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          influencers: result.influencers,
          total: result.total,
        },
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

