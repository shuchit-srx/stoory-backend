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
}

module.exports = new UserController();

