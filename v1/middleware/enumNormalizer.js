/**
 * Enum Normalizer Middleware
 * Normalizes enum values to uppercase before they reach services
 */

/**
 * Normalize enum values in request body to uppercase
 */
function normalizeEnums(req, res, next) {
  if (req.body) {
    // Gender enum
    if (req.body.gender !== undefined && req.body.gender !== null) {
      const normalized = String(req.body.gender).toUpperCase().trim();
      const validGenders = ["MALE", "FEMALE", "OTHER"];
      if (validGenders.includes(normalized)) {
        req.body.gender = normalized;
      } else {
        // Still normalize to uppercase even if not in valid list
        // The service will handle validation and return null if invalid
        req.body.gender = normalized;
      }
    }

    // Tier enum
    if (req.body.tier !== undefined && req.body.tier !== null) {
      const normalized = String(req.body.tier).toUpperCase().trim();
      const validTiers = ["NANO", "MICRO", "MID", "MACRO"];
      if (validTiers.includes(normalized)) {
        req.body.tier = normalized;
      }
    }

    // Influencer tier enum
    if (req.body.influencer_tier !== undefined && req.body.influencer_tier !== null) {
      const normalized = String(req.body.influencer_tier).toUpperCase().trim();
      const validTiers = ["NANO", "MICRO", "MID", "MACRO"];
      if (validTiers.includes(normalized)) {
        req.body.influencer_tier = normalized;
      }
    }

    // Campaign type enum
    if (req.body.type !== undefined && req.body.type !== null) {
      const normalized = String(req.body.type).toUpperCase().trim();
      const validTypes = ["NORMAL", "BULK"];
      if (validTypes.includes(normalized)) {
        req.body.type = normalized;
      }
    }

    // Campaign status enum
    if (req.body.status !== undefined && req.body.status !== null) {
      const normalized = String(req.body.status).toUpperCase().trim();
      const validStatuses = ["DRAFT", "LIVE", "LOCKED", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"];
      if (validStatuses.includes(normalized)) {
        req.body.status = normalized;
      }
    }

    // Billing cycle enum
    if (req.body.billing_cycle !== undefined && req.body.billing_cycle !== null) {
      const normalized = String(req.body.billing_cycle).toUpperCase().trim();
      const validBillingCycles = ["MONTHLY", "YEARLY"];
      if (validBillingCycles.includes(normalized)) {
        req.body.billing_cycle = normalized;
      }
    }

    // Application phase enum
    if (req.body.phase !== undefined && req.body.phase !== null) {
      const normalized = String(req.body.phase).toUpperCase().trim();
      const validPhases = ["APPLIED", "ACCEPTED", "SCRIPT", "WORK", "PAYOUT", "COMPLETED", "CANCELLED"];
      if (validPhases.includes(normalized)) {
        req.body.phase = normalized;
      }
    }

    // Script/Work submission status enum
    if (req.body.status !== undefined && req.body.status !== null) {
      const normalized = String(req.body.status).toUpperCase().trim();
      const validSubmissionStatuses = ["PENDING", "ACCEPTED", "REVISION", "REJECTED"];
      // Only normalize if it's a valid submission status (not campaign status)
      if (validSubmissionStatuses.includes(normalized)) {
        // Check if this is likely a submission status (not campaign status)
        // We'll normalize it if it matches submission statuses
        req.body.status = normalized;
      }
    }

    // Entity type enum (for rejections)
    if (req.body.entity_type !== undefined && req.body.entity_type !== null) {
      const normalized = String(req.body.entity_type).toUpperCase().trim();
      const validEntityTypes = ["SCRIPT", "WORK"];
      if (validEntityTypes.includes(normalized)) {
        req.body.entity_type = normalized;
      }
    }

    // Rejected by role enum
    if (req.body.rejected_by_role !== undefined && req.body.rejected_by_role !== null) {
      const normalized = String(req.body.rejected_by_role).toUpperCase().trim();
      const validRoles = ["BRAND", "ADMIN"];
      if (validRoles.includes(normalized)) {
        req.body.rejected_by_role = normalized;
      }
    }

    // Role enum
    if (req.body.role !== undefined && req.body.role !== null) {
      const normalized = String(req.body.role).toUpperCase().trim();
      const validRoles = ["BRAND_OWNER", "INFLUENCER", "ADMIN"];
      if (validRoles.includes(normalized)) {
        req.body.role = normalized;
      }
    }

    // Social platforms array
    if (Array.isArray(req.body.social_platforms)) {
      req.body.social_platforms = req.body.social_platforms.map((platform) => {
        const normalized = { ...platform };
        
        // Normalize platform name
        if (normalized.platform_name || normalized.platform || normalized.platformName) {
          const platformName = normalized.platform_name || normalized.platform || normalized.platformName;
          const normalizedPlatform = String(platformName).toUpperCase().trim();
          const validPlatforms = ["INSTAGRAM", "FACEBOOK", "YOUTUBE"];
          if (validPlatforms.includes(normalizedPlatform)) {
            normalized.platform_name = normalizedPlatform;
            normalized.platform = normalizedPlatform;
            normalized.platformName = normalizedPlatform;
          }
        }

        // Normalize data_source
        if (normalized.data_source !== undefined && normalized.data_source !== null) {
          const normalizedDataSource = String(normalized.data_source).toUpperCase().trim();
          const validDataSources = ["MANUAL", "GRAPH_API"];
          if (validDataSources.includes(normalizedDataSource)) {
            normalized.data_source = normalizedDataSource;
          }
        }

        return normalized;
      });
    }

    // Normalize query parameters
    if (req.query) {
      // Campaign status filter
      if (req.query.status !== undefined && req.query.status !== null) {
        const normalized = String(req.query.status).toUpperCase().trim();
        const validStatuses = ["DRAFT", "LIVE", "LOCKED", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"];
        if (validStatuses.includes(normalized)) {
          req.query.status = normalized;
        }
      }

      // Campaign type filter
      if (req.query.type !== undefined && req.query.type !== null) {
        const normalized = String(req.query.type).toUpperCase().trim();
        const validTypes = ["NORMAL", "BULK"];
        if (validTypes.includes(normalized)) {
          req.query.type = normalized;
        }
      }

      // Application phase filter
      if (req.query.phase !== undefined && req.query.phase !== null) {
        const normalized = String(req.query.phase).toUpperCase().trim();
        const validPhases = ["APPLIED", "ACCEPTED", "SCRIPT", "WORK", "PAYOUT", "COMPLETED", "CANCELLED"];
        if (validPhases.includes(normalized)) {
          req.query.phase = normalized;
        }
      }

      // Script/Work submission status filter
      if (req.query.status !== undefined && req.query.status !== null) {
        const normalized = String(req.query.status).toUpperCase().trim();
        const validSubmissionStatuses = ["PENDING", "ACCEPTED", "REVISION", "REJECTED"];
        if (validSubmissionStatuses.includes(normalized)) {
          req.query.status = normalized;
        }
      }

      // Payout status filter
      if (req.query.payout_status !== undefined && req.query.payout_status !== null) {
        const normalized = String(req.query.payout_status).toUpperCase().trim();
        const validPayoutStatuses = ["PENDING", "RELEASED", "FAILED"];
        if (validPayoutStatuses.includes(normalized)) {
          req.query.payout_status = normalized;
        }
      }

      // Payment order status filter
      if (req.query.payment_status !== undefined && req.query.payment_status !== null) {
        const normalized = String(req.query.payment_status).toUpperCase().trim();
        const validPaymentStatuses = ["CREATED", "PROCESSING", "VERIFIED", "FAILED", "REFUNDED"];
        if (validPaymentStatuses.includes(normalized)) {
          req.query.payment_status = normalized;
        }
      }
    }

    // Payment order status in body
    if (req.body.payment_status !== undefined && req.body.payment_status !== null) {
      const normalized = String(req.body.payment_status).toUpperCase().trim();
      const validPaymentStatuses = ["CREATED", "PROCESSING", "VERIFIED", "FAILED", "REFUNDED"];
      if (validPaymentStatuses.includes(normalized)) {
        req.body.payment_status = normalized;
      }
    }
  }

  next();
}

module.exports = {
  normalizeEnums,
};

