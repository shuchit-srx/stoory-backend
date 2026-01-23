const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../db/config");

class AuthMiddleware {
  constructor() {
    this.jwtSecret =
      process.env.JWT_SECRET || "your-secret-key-change-in-production";
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      // Ensure decoded token has the expected structure
      // Token should contain: { id, phone, role } (from authService.generateToken)
      console.log("[v1/authMiddleware] Token decoded successfully:", {
        hasId: !!decoded.id,
        hasRole: !!decoded.role,
        hasPhone: !!decoded.phone,
        allFields: Object.keys(decoded),
      });
      return { success: true, user: decoded };
    } catch (error) {
      console.log("[v1/authMiddleware] Token verification error:", {
        error: error.message,
        errorName: error.name,
        tokenPrefix: token ? token.substring(0, 20) + "..." : "no token",
      });
      return { success: false, message: error.message };
    }
  }

  /**
   * Middleware to authenticate requests using JWT token
   */
  authenticateToken = (req, res, next) => {
    // Check for Authorization header (case-insensitive)
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    // Verify JWT token
    const result = this.verifyToken(token);
    if (!result.success) {
      console.log("⛔ [AUTH] Token verification failed:", result.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = result.user;
    next();
  };

  /**
   * Optional authentication middleware - doesn't fail if no token provided
   * Sets req.user if valid token is present, otherwise continues without req.user
   */
  authenticateTokenOptional = (req, res, next) => {
    // Check for Authorization header (Express normalizes to lowercase)
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    
    // Extract token - handle "Bearer <token>" or just "<token>"
    let token = null;
    if (authHeader) {
      const parts = authHeader.trim().split(" ");
      token = parts.length > 1 ? parts[1] : (parts[0].toLowerCase() === "bearer" ? null : parts[0]);
    }

    console.log("[v1/authMiddleware] authenticateTokenOptional:", {
      hasAuthHeader: !!authHeader,
      authHeaderPrefix: authHeader?.substring(0, 30) || "none",
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      tokenPrefix: token ? token.substring(0, 20) + "..." : "none",
      allHeaders: Object.keys(req.headers).filter(h => h.toLowerCase().includes("auth")),
    });

    if (!token) {
      // No token provided - continue without authentication
      console.log("[v1/authMiddleware] No token provided - continuing without auth");
      req.user = undefined;
      return next();
    }

    // Verify JWT token
    const result = this.verifyToken(token);
    if (!result.success) {
      // Invalid token - continue without authentication
      console.log("[v1/authMiddleware] Token verification failed:", {
        error: result.message,
        tokenPrefix: token.substring(0, 20) + "...",
      });
      req.user = undefined;
      return next();
    }

    // Valid token - set user
    console.log("[v1/authMiddleware] Token verified successfully:", {
      userId: result.user?.id,
      userRole: result.user?.role,
      userPhone: result.user?.phone,
      allFields: Object.keys(result.user || {}),
    });
    req.user = result.user;
    next();
  };

  /**
   * Middleware to check role permissions
   */
  requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const userRole = req.user.role;
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    };
  }
}

module.exports = new AuthMiddleware();
