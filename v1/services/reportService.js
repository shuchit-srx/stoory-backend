const { supabaseAdmin } = require("../db/config");

/**
 * Report Service
 * Handles business logic for reports
 */
class ReportService {
  /**
   * Create a new report
   * @param {Object} reportData - Report data
   * @param {string} reportData.reporter_id - ID of the user creating the report
   * @param {string} reportData.reported_user_id - ID of the user being reported
   * @param {string} reportData.application_id - ID of the application
   * @param {string} reportData.type - Type of report: "BY_BRAND" or "BY_INFLUENCER"
   * @param {string} reportData.description - Description of the issue (10-5000 characters)
   * @returns {Promise<Object>} Result with created report
   */
  async createReport(reportData) {
    try {
      const {
        reporter_id,
        reported_user_id,
        application_id,
        type,
        description,
      } = reportData;

      // Validate required fields
      if (!reporter_id || !reported_user_id || !application_id || !type || !description) {
        return {
          success: false,
          message: "All required fields must be provided",
        };
      }

      // Validate description length
      if (description.length < 10 || description.length > 5000) {
        return {
          success: false,
          message: "Description must be between 10 and 5000 characters",
        };
      }

      // Validate type
      const normalizedType = type.toUpperCase();
      if (normalizedType !== "BY_BRAND" && normalizedType !== "BY_INFLUENCER") {
        return {
          success: false,
          message: "Type must be BY_BRAND or BY_INFLUENCER",
        };
      }

      // Check if reporter is reporting themselves
      if (reporter_id === reported_user_id) {
        return {
          success: false,
          message: "You cannot report yourself",
        };
      }

      // Get application to validate relationships
      const { data: application, error: applicationError } = await supabaseAdmin
        .from("v1_applications")
        .select(`
          id,
          influencer_id,
          v1_campaigns!inner(
            id,
            brand_id
          )
        `)
        .eq("id", application_id)
        .single();

      if (applicationError || !application) {
        return {
          success: false,
          message: "Application not found",
        };
      }

      const brandId = application.v1_campaigns.brand_id;
      const influencerId = application.influencer_id;

      // Validate reporter is either brand owner or influencer
      if (reporter_id !== brandId && reporter_id !== influencerId) {
        return {
          success: false,
          message: "You can only report for applications you are involved in",
        };
      }

      // Validate reported user is the other party
      if (normalizedType === "BY_BRAND") {
        // Brand is reporting, so reported user must be influencer
        if (reported_user_id !== influencerId) {
          return {
            success: false,
            message: "Reported user must be the influencer for this application",
          };
        }
        // Reporter must be brand owner
        if (reporter_id !== brandId) {
          return {
            success: false,
            message: "Only the brand owner can create BY_BRAND reports",
          };
        }
      } else if (normalizedType === "BY_INFLUENCER") {
        // Influencer is reporting, so reported user must be brand owner
        if (reported_user_id !== brandId) {
          return {
            success: false,
            message: "Reported user must be the brand owner for this application",
          };
        }
        // Reporter must be influencer
        if (reporter_id !== influencerId) {
          return {
            success: false,
            message: "Only the influencer can create BY_INFLUENCER reports",
          };
        }
      }

      // Check if reporter already has a report for this application
      const { data: existingReport } = await supabaseAdmin
        .from("v1_reports")
        .select("id")
        .eq("reporter_id", reporter_id)
        .eq("application_id", application_id)
        .maybeSingle();

      if (existingReport) {
        return {
          success: false,
          message: "You have already reported this application",
        };
      }

      // Create the report
      const { data: report, error: createError } = await supabaseAdmin
        .from("v1_reports")
        .insert({
          reporter_id,
          reported_user_id,
          application_id,
          type: normalizedType,
          description,
          status: "PENDING",
        })
        .select()
        .single();

      if (createError) {
        console.error("[v1/ReportService/createReport] Database error:", createError);
        return {
          success: false,
          message: "Failed to create report",
          error: createError.message,
        };
      }

      return {
        success: true,
        report,
        message: "Report created successfully",
      };
    } catch (err) {
      console.error("[v1/ReportService/createReport] Exception:", err);
      return {
        success: false,
        message: "Failed to create report",
        error: err.message,
      };
    }
  }

  /**
   * Get all reports with filtering and pagination
   * @param {Object} options - Query options
   * @param {string} options.userId - ID of the user making the request
   * @param {string} options.userRole - Role of the user (ADMIN, BRAND_OWNER, INFLUENCER)
   * @param {string} options.status - Filter by status (optional)
   * @param {string} options.type - Filter by type (optional)
   * @param {string} options.application_id - Filter by application ID (optional)
   * @param {string} options.reported_user_id - Filter by reported user ID (optional)
   * @param {string} options.reporter_id - Filter by reporter ID (optional)
   * @param {number} options.limit - Number of results per page (default: 20)
   * @param {number} options.offset - Number of results to skip (default: 0)
   * @returns {Promise<Object>} Result with reports and pagination info
   */
  async getAllReports(options) {
    try {
      const {
        userId,
        userRole,
        status,
        type,
        application_id,
        reported_user_id,
        reporter_id,
        limit = 20,
        offset = 0,
      } = options;

      // Build query
      let query = supabaseAdmin
        .from("v1_reports")
        .select(`
          *,
          application:v1_applications(
            id,
            phase,
            v1_campaigns(
              id,
              title
            )
          )
        `, { count: "exact" })
        .order("created_at", { ascending: false });

      // Apply access control: non-admins can only see reports where they are involved
      if (userRole !== "ADMIN") {
        query = query.or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`);
      }

      // Apply filters
      if (status) {
        query = query.eq("status", status.toUpperCase());
      }
      if (type) {
        query = query.eq("type", type.toUpperCase());
      }
      if (application_id) {
        query = query.eq("application_id", application_id);
      }
      if (reported_user_id) {
        query = query.eq("reported_user_id", reported_user_id);
      }
      if (reporter_id) {
        query = query.eq("reporter_id", reporter_id);
      }

      // Apply pagination
      const { data: reports, error, count } = await query.range(offset, offset + limit - 1);

      if (error) {
        console.error("[v1/ReportService/getAllReports] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch reports",
          error: error.message,
        };
      }

      // Fetch user data separately
      const reporterIds = [...new Set((reports || []).map(r => r.reporter_id).filter(Boolean))];
      const reportedUserIds = [...new Set((reports || []).map(r => r.reported_user_id).filter(Boolean))];
      const allUserIds = [...new Set([...reporterIds, ...reportedUserIds])];

      let userMap = {};
      if (allUserIds.length > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("v1_users")
          .select("id, name, phone, email")
          .in("id", allUserIds)
          .eq("is_deleted", false);

        if (usersError) {
          console.error("[v1/ReportService/getAllReports] Users fetch error:", usersError);
        } else if (users) {
          users.forEach(user => {
            userMap[user.id] = user;
          });
        }
      }

      // Format reports to remove v1_ prefixes
      const formattedReports = (reports || []).map((report) => {
        const formatted = { ...report };
        formatted.reporter = userMap[report.reporter_id] || null;
        formatted.reported_user = userMap[report.reported_user_id] || null;
        if (report.application) {
          const { v1_campaigns, ...applicationData } = report.application;
          formatted.application = {
            ...applicationData,
            campaign: v1_campaigns || null,
          };
        }
        return formatted;
      });

      const hasMore = (offset + limit) < (count || 0);

      return {
        success: true,
        reports: formattedReports,
        pagination: {
          limit,
          offset,
          count: formattedReports.length,
          total: count || 0,
          has_more: hasMore,
        },
        message: "Reports fetched successfully",
      };
    } catch (err) {
      console.error("[v1/ReportService/getAllReports] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch reports",
        error: err.message,
      };
    }
  }

  /**
   * Get all pending reports (Admin only)
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of results per page (default: 20)
   * @param {number} options.offset - Number of results to skip (default: 0)
   * @returns {Promise<Object>} Result with pending reports and pagination info
   */
  async getPendingReports(options) {
    try {
      const { limit = 20, offset = 0 } = options;

      // Build query for pending reports
      const { data: reports, error, count } = await supabaseAdmin
        .from("v1_reports")
        .select(`
          *,
          application:v1_applications(
            id,
            phase,
            v1_campaigns(
              id,
              title
            )
          )
        `, { count: "exact" })
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("[v1/ReportService/getPendingReports] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch pending reports",
          error: error.message,
        };
      }

      // Fetch user data separately
      const reporterIds = [...new Set((reports || []).map(r => r.reporter_id).filter(Boolean))];
      const reportedUserIds = [...new Set((reports || []).map(r => r.reported_user_id).filter(Boolean))];
      const allUserIds = [...new Set([...reporterIds, ...reportedUserIds])];

      let userMap = {};
      if (allUserIds.length > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("v1_users")
          .select("id, name, phone, email")
          .in("id", allUserIds)
          .eq("is_deleted", false);

        if (usersError) {
          console.error("[v1/ReportService/getPendingReports] Users fetch error:", usersError);
        } else if (users) {
          users.forEach(user => {
            userMap[user.id] = user;
          });
        }
      }

      // Format reports to remove v1_ prefixes
      const formattedReports = (reports || []).map((report) => {
        const formatted = { ...report };
        formatted.reporter = userMap[report.reporter_id] || null;
        formatted.reported_user = userMap[report.reported_user_id] || null;
        if (report.application) {
          const { v1_campaigns, ...applicationData } = report.application;
          formatted.application = {
            ...applicationData,
            campaign: v1_campaigns || null,
          };
        }
        return formatted;
      });

      const hasMore = (offset + limit) < (count || 0);

      return {
        success: true,
        reports: formattedReports,
        pagination: {
          limit,
          offset,
          count: formattedReports.length,
          total: count || 0,
          has_more: hasMore,
        },
        message: "Pending reports fetched successfully",
      };
    } catch (err) {
      console.error("[v1/ReportService/getPendingReports] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch pending reports",
        error: err.message,
      };
    }
  }

  /**
   * Get a single report by ID
   * @param {Object} options - Query options
   * @param {string} options.reportId - ID of the report
   * @param {string} options.userId - ID of the user making the request
   * @param {string} options.userRole - Role of the user (ADMIN, BRAND_OWNER, INFLUENCER)
   * @returns {Promise<Object>} Result with report
   */
  async getReportById(options) {
    try {
      const { reportId, userId, userRole } = options;

      // Build query
      let query = supabaseAdmin
        .from("v1_reports")
        .select(`
          *,
          application:v1_applications(
            id,
            phase,
            v1_campaigns(
              id,
              title
            )
          )
        `)
        .eq("id", reportId)
        .single();

      const { data: report, error } = await query;

      if (error || !report) {
        return {
          success: false,
          message: "Report not found",
        };
      }

      // Apply access control: non-admins can only see reports where they are involved
      if (userRole !== "ADMIN") {
        if (report.reporter_id !== userId && report.reported_user_id !== userId) {
          return {
            success: false,
            message: "Unauthorized: You can only view your own reports",
          };
        }
      }

      // Fetch user data separately
      const userIds = [report.reporter_id, report.reported_user_id].filter(Boolean);
      let userMap = {};
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("v1_users")
          .select("id, name, phone, email")
          .in("id", userIds)
          .eq("is_deleted", false);

        if (usersError) {
          console.error("[v1/ReportService/getReportById] Users fetch error:", usersError);
        } else if (users) {
          users.forEach(user => {
            userMap[user.id] = user;
          });
        }
      }

      // Format report to remove v1_ prefixes
      const formatted = { ...report };
      formatted.reporter = userMap[report.reporter_id] || null;
      formatted.reported_user = userMap[report.reported_user_id] || null;
      if (report.application) {
        const { v1_campaigns, ...applicationData } = report.application;
        formatted.application = {
          ...applicationData,
          campaign: v1_campaigns || null,
        };
      }

      return {
        success: true,
        report: formatted,
        message: "Report fetched successfully",
      };
    } catch (err) {
      console.error("[v1/ReportService/getReportById] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch report",
        error: err.message,
      };
    }
  }

  /**
   * Update a report (Admin only)
   * @param {Object} options - Update options
   * @param {string} options.reportId - ID of the report
   * @param {string} options.status - New status (optional)
   * @param {string} options.admin_notes - Admin notes (optional)
   * @returns {Promise<Object>} Result with updated report
   */
  async updateReport(options) {
    try {
      const { reportId, status, admin_notes } = options;

      // Validate at least one field is provided
      if (!status && admin_notes === undefined) {
        return {
          success: false,
          message: "No valid fields to update. Only status and admin_notes can be updated",
        };
      }

      // Build update object
      const updateData = {};
      if (status) {
        const normalizedStatus = status.toUpperCase();
        if (normalizedStatus !== "PENDING" && normalizedStatus !== "RESOLVED") {
          return {
            success: false,
            message: "Invalid status. Must be PENDING or RESOLVED",
          };
        }
        updateData.status = normalizedStatus;
      }
      if (admin_notes !== undefined) {
        if (admin_notes && admin_notes.length > 5000) {
          return {
            success: false,
            message: "Admin notes must be 5000 characters or less",
          };
        }
        updateData.admin_notes = admin_notes || null;
      }

      // Update the report
      const { data: report, error } = await supabaseAdmin
        .from("v1_reports")
        .update(updateData)
        .eq("id", reportId)
        .select()
        .single();

      if (error || !report) {
        console.error("[v1/ReportService/updateReport] Database error:", error);
        return {
          success: false,
          message: "Failed to update report",
          error: error?.message || "Report not found",
        };
      }

      return {
        success: true,
        report,
        message: "Report updated successfully",
      };
    } catch (err) {
      console.error("[v1/ReportService/updateReport] Exception:", err);
      return {
        success: false,
        message: "Failed to update report",
        error: err.message,
      };
    }
  }
}

module.exports = new ReportService();

