const { supabaseAdmin } = require("../db/config");
const { uploadPortfolioMediaToStorage, deletePortfolioMediaFromStorage } = require("../utils/imageUpload");

/**
 * Portfolio Service
 * Handles business logic for influencer portfolio operations
 */
class PortfolioService {
  /**
   * Create a new portfolio item
   * @param {string} userId - User ID of the influencer
   * @param {Object} portfolioData - Portfolio item data (can include file uploads)
   * @returns {Promise<Object>} - Created portfolio item or error
   */
  async createPortfolioItem(userId, portfolioData) {
    try {
      // Validate media_type
      const mediaType = portfolioData.media_type?.toUpperCase().trim();
      if (!mediaType || !["IMAGE", "VIDEO"].includes(mediaType)) {
        return {
          success: false,
          message: "media_type must be IMAGE or VIDEO",
        };
      }

      // Handle file upload - file upload takes priority over direct URL
      let mediaUrl = null;
      if (portfolioData.media_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadPortfolioMediaToStorage(
          portfolioData.media_file.buffer,
          portfolioData.media_file.originalname,
          portfolioData.media_file.mimetype
        );

        if (uploadError || !url) {
          console.error(
            "[v1/PortfolioService/createPortfolioItem] Media upload error:",
            uploadError
          );
          return {
            success: false,
            message: uploadError || "Failed to upload media file",
          };
        }

        mediaUrl = url;

        // Validate uploaded file type matches media_type
        const isVideo = portfolioData.media_file.mimetype.startsWith('video/');
        const isImage = portfolioData.media_file.mimetype.startsWith('image/');
        
        if (mediaType === "VIDEO" && !isVideo) {
          // Delete uploaded file if type mismatch
          await deletePortfolioMediaFromStorage(mediaUrl);
          return {
            success: false,
            message: "Uploaded file must be a video for VIDEO media_type",
          };
        }
        
        if (mediaType === "IMAGE" && !isImage) {
          // Delete uploaded file if type mismatch
          await deletePortfolioMediaFromStorage(mediaUrl);
          return {
            success: false,
            message: "Uploaded file must be an image for IMAGE media_type",
          };
        }
      } else if (portfolioData.media_url !== undefined) {
        // Direct URL provided (no file upload)
        if (!portfolioData.media_url || typeof portfolioData.media_url !== "string" || portfolioData.media_url.trim().length === 0) {
          return {
            success: false,
            message: "media_url is required and must be a non-empty string",
          };
        }
        mediaUrl = portfolioData.media_url.trim();
      } else {
        // Neither file nor URL provided
        return {
          success: false,
          message: "Either media_file or media_url must be provided",
        };
      }

      // Handle thumbnail upload
      let thumbnailUrl = null;
      if (portfolioData.thumbnail_file) {
        // Thumbnail file upload - upload to storage
        const { url, error: uploadError } = await uploadPortfolioMediaToStorage(
          portfolioData.thumbnail_file.buffer,
          portfolioData.thumbnail_file.originalname,
          portfolioData.thumbnail_file.mimetype
        );

        if (uploadError || !url) {
          console.error(
            "[v1/PortfolioService/createPortfolioItem] Thumbnail upload error:",
            uploadError
          );
          // Don't fail the entire request if thumbnail upload fails, just log it
          console.warn("Thumbnail upload failed, continuing without thumbnail");
        } else {
          thumbnailUrl = url;
        }
      } else if (portfolioData.thumbnail_url !== undefined && portfolioData.thumbnail_url !== null) {
        thumbnailUrl = portfolioData.thumbnail_url.trim() || null;
      }

      // Validate duration_seconds for VIDEO
      let durationSeconds = null;
      if (mediaType === "VIDEO") {
        if (portfolioData.duration_seconds === null || portfolioData.duration_seconds === undefined) {
          return {
            success: false,
            message: "duration_seconds is required for VIDEO media_type",
          };
        }
        durationSeconds = parseInt(portfolioData.duration_seconds);
        if (isNaN(durationSeconds) || durationSeconds < 0 || durationSeconds > 120) {
          return {
            success: false,
            message: "duration_seconds must be between 0 and 120 for VIDEO",
          };
        }
      } else if (mediaType === "IMAGE") {
        // IMAGE should not have duration_seconds
        if (portfolioData.duration_seconds !== null && portfolioData.duration_seconds !== undefined) {
          return {
            success: false,
            message: "duration_seconds must be null for IMAGE media_type",
          };
        }
      }

      // Build portfolio item object
      const portfolioItem = {
        user_id: userId,
        media_type: mediaType,
        media_url: mediaUrl,
        thumbnail_url: thumbnailUrl,
        duration_seconds: durationSeconds,
        description: portfolioData.description?.trim() || null,
        is_deleted: false,
      };

      // Insert portfolio item
      const { data, error } = await supabaseAdmin
        .from("v1_influencer_portfolio")
        .insert(portfolioItem)
        .select()
        .single();

      if (error) {
        console.error("[v1/PortfolioService/createPortfolioItem] Database error:", error);
        return {
          success: false,
          message: "Failed to create portfolio item",
          error: error.message,
        };
      }

      return {
        success: true,
        message: "Portfolio item created successfully",
        portfolio: data,
      };
    } catch (err) {
      console.error("[v1/PortfolioService/createPortfolioItem] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }

  /**
   * Get portfolio items
   * @param {Object} filters - Filter options (user_id, media_type)
   * @param {Object} pagination - Pagination options (page, limit)
   * @param {string} requesterRole - Role of the user making the request
   * @param {string} requesterId - ID of the user making the request
   * @returns {Promise<Object>} - Portfolio items or error
   */
  async getPortfolioItems(filters = {}, pagination = {}, requesterRole, requesterId) {
    try {
      let query = supabaseAdmin
        .from("v1_influencer_portfolio")
        .select("*", { count: "exact" })
        .eq("is_deleted", false);

      // Apply filters
      if (filters.user_id) {
        // If requester is INFLUENCER, they can only see their own portfolio
        if (requesterRole === "INFLUENCER" && filters.user_id !== requesterId) {
          return {
            success: false,
            message: "You can only view your own portfolio",
            statusCode: 403,
          };
        }
        query = query.eq("user_id", filters.user_id);
      } else if (requesterRole === "INFLUENCER") {
        // If no user_id filter and requester is INFLUENCER, show only their portfolio
        query = query.eq("user_id", requesterId);
      }
      // BRAND_OWNER and ADMIN can see all portfolios if no user_id filter is provided

      if (filters.media_type) {
        const mediaType = filters.media_type.toUpperCase().trim();
        if (["IMAGE", "VIDEO"].includes(mediaType)) {
          query = query.eq("media_type", mediaType);
        }
      }

      // Apply pagination - Using offset + limit for infinite scroll
      const limit = Math.min(parseInt(pagination.limit) || 20, 100);
      const offset = Math.max(0, parseInt(pagination.offset) || 0);

      query = query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error("[v1/PortfolioService/getPortfolioItems] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch portfolio items",
          error: error.message,
        };
      }

      const hasMore = (offset + limit) < (count || 0);

      return {
        success: true,
        portfolios: data || [],
        pagination: {
          limit,
          offset,
          count: (data || []).length,
          total: count || 0,
          hasMore,
        },
      };
    } catch (err) {
      console.error("[v1/PortfolioService/getPortfolioItems] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }
}

module.exports = new PortfolioService();

