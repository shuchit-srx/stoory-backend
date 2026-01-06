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
    }
  }

  next();
}

module.exports = {
  normalizeEnums,
};

