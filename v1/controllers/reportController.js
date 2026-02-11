const { validationResult } = require("express-validator");
const ReportService = require("../services/reportService");

/**
 * Report Controller
 * Handles HTTP requests for report-related endpoints
 */
class ReportController {
  /**
   * Create a new report
   * POST /api/v1/reports/create
   */
  async createReport(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { reported_user_id, application_id, type, description } = req.body;

      const result = await ReportService.createReport({
        reporter_id: userId,
        reported_user_id,
        application_id,
        type,
        description,
      });

      if (!result.success) {
        const statusCode =
          result.message === "Application not found" ? 404
          : result.message === "You cannot report yourself" ||
            result.message === "You can only report for applications you are involved in" ||
            result.message === "Reported user must be the influencer for this application" ||
            result.message === "Reported user must be the brand owner for this application" ||
            result.message === "Only the brand owner can create BY_BRAND reports" ||
            result.message === "Only the influencer can create BY_INFLUENCER reports" ||
            result.message === "You have already reported this application" ||
            result.message === "Description must be between 10 and 5000 characters" ||
            result.message === "Type must be BY_BRAND or BY_INFLUENCER"
            ? 400
            : 500;
        return res.status(statusCode).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return res.status(201).json({
        success: true,
        report: result.report,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/ReportController/createReport] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get all reports with filtering and pagination
   * GET /api/v1/reports/get/all
   */
  async getAllReports(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      const {
        status,
        type,
        application_id,
        reported_user_id,
        reporter_id,
        limit,
        offset,
      } = req.query;

      // Validate pagination
      const limitNum = Math.min(parseInt(limit) || 20, 100);
      const offsetNum = Math.max(parseInt(offset) || 0, 0);

      if (isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid limit. Must be >= 1",
        });
      }

      if (isNaN(offsetNum) || offsetNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offset. Must be >= 0",
        });
      }

      const result = await ReportService.getAllReports({
        userId,
        userRole,
        status,
        type,
        application_id,
        reported_user_id,
        reporter_id,
        limit: limitNum,
        offset: offsetNum,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        reports: result.reports,
        pagination: result.pagination,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/ReportController/getAllReports] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get all pending reports (Admin only)
   * GET /api/v1/reports/get/pending
   */
  async getPendingReports(req, res) {
    try {
      const { limit, offset } = req.query;

      // Validate pagination
      const limitNum = Math.min(parseInt(limit) || 20, 100);
      const offsetNum = Math.max(parseInt(offset) || 0, 0);

      if (isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid limit. Must be >= 1",
        });
      }

      if (isNaN(offsetNum) || offsetNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offset. Must be >= 0",
        });
      }

      const result = await ReportService.getPendingReports({
        limit: limitNum,
        offset: offsetNum,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        reports: result.reports,
        pagination: result.pagination,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/ReportController/getPendingReports] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Get a single report by ID
   * GET /api/v1/reports/get/:id
   */
  async getReportById(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const reportId = req.params.id;

      const result = await ReportService.getReportById({
        reportId,
        userId,
        userRole,
      });

      if (!result.success) {
        const statusCode =
          result.message === "Report not found" ||
          result.message === "Unauthorized: You can only view your own reports"
            ? 404
            : 500;
        return res.status(statusCode).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        report: result.report,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/ReportController/getReportById] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  /**
   * Update a report (Admin only)
   * PUT /api/v1/reports/update/:id
   */
  async updateReport(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const reportId = req.params.id;
      const { status, admin_notes } = req.body;

      const result = await ReportService.updateReport({
        reportId,
        status,
        admin_notes,
      });

      if (!result.success) {
        const statusCode =
          result.message === "Invalid status. Must be PENDING or RESOLVED" ||
          result.message === "No valid fields to update. Only status and admin_notes can be updated" ||
          result.message === "Admin notes must be 5000 characters or less"
            ? 400
            : result.message === "Failed to update report" || result.message.includes("not found")
            ? 404
            : 500;
        return res.status(statusCode).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        report: result.report,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/ReportController/updateReport] Exception:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  }
}

module.exports = new ReportController();

