/**
 * Enum Normalization Utility
 * Centralized enum normalization functions for consistent data handling across services
 */

/**
 * Normalize gender value to match database constraint (uppercase)
 * Valid values: MALE, FEMALE, OTHER
 * @param {string} gender - Gender value to normalize
 * @returns {string|null} - Normalized uppercase gender or null if invalid
 */
function normalizeGender(gender) {
  if (!gender) return null;

  const normalized = String(gender).toUpperCase().trim();
  const validGenders = ["MALE", "FEMALE", "OTHER"];

  if (validGenders.includes(normalized)) {
    return normalized;
  }

  // Handle lowercase variations
  const lower = normalized.toLowerCase();
  if (lower === "male") return "MALE";
  if (lower === "female") return "FEMALE";
  if (lower === "other") return "OTHER";

  return null; // Invalid gender, return null
}

/**
 * Normalize tier value to match database constraint (uppercase)
 * Valid values: NANO, MICRO, MID, MACRO
 * @param {string} tier - Tier value to normalize
 * @returns {string|null} - Normalized uppercase tier or null if invalid
 */
function normalizeTier(tier) {
  if (!tier) return null;

  const normalized = String(tier).toUpperCase().trim();
  const validTiers = ["NANO", "MICRO", "MID", "MACRO"];

  if (validTiers.includes(normalized)) {
    return normalized;
  }

  // Handle lowercase variations
  const lower = normalized.toLowerCase();
  if (lower === "nano") return "NANO";
  if (lower === "micro") return "MICRO";
  if (lower === "mid") return "MID";
  if (lower === "macro") return "MACRO";

  return null; // Invalid tier, return null
}

/**
 * Normalize platform name to match database constraint (uppercase)
 * Valid values: INSTAGRAM, FACEBOOK, YOUTUBE
 * @param {string} platformName - Platform name to normalize
 * @returns {string|null} - Normalized uppercase platform name or null if invalid
 */
function normalizePlatform(platformName) {
  if (!platformName) return null;

  const normalized = String(platformName).toUpperCase().trim();
  const validPlatforms = ["INSTAGRAM", "FACEBOOK", "YOUTUBE"];

  if (validPlatforms.includes(normalized)) {
    return normalized;
  }

  // Handle common variations
  const lower = normalized.toLowerCase();
  if (lower === "instagram" || lower === "ig") return "INSTAGRAM";
  if (lower === "facebook" || lower === "fb") return "FACEBOOK";
  if (lower === "youtube" || lower === "yt") return "YOUTUBE";

  return null; // Invalid platform
}

/**
 * Normalize campaign type to match database constraint (uppercase)
 * Valid values: NORMAL, BULK
 * @param {string} type - Campaign type to normalize
 * @returns {string|null} - Normalized uppercase type or null if invalid
 */
function normalizeCampaignType(type) {
  if (!type) return null;

  const normalized = String(type).toUpperCase().trim();
  const validTypes = ["NORMAL", "BULK"];

  if (validTypes.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid type
}

/**
 * Normalize payment status to match database constraint (uppercase)
 * Valid values: CREATED, PROCESSING, VERIFIED, FAILED, REFUNDED
 * @param {string} status - Payment status to normalize
 * @returns {string|null} - Normalized uppercase status or null if invalid
 */
function normalizePaymentStatus(status) {
  if (!status) return null;

  const normalized = String(status).toUpperCase().trim();
  const validStatuses = ["CREATED", "PROCESSING", "VERIFIED", "FAILED", "REFUNDED"];

  if (validStatuses.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid status
}

/**
 * Normalize campaign status to match database constraint (uppercase)
 * Valid values: DRAFT, LIVE, LOCKED, ACTIVE, COMPLETED, EXPIRED, CANCELLED
 * @param {string} status - Campaign status to normalize
 * @returns {string|null} - Normalized uppercase status or null if invalid
 */
function normalizeCampaignStatus(status) {
  if (!status) return null;

  const normalized = String(status).toUpperCase().trim();
  const validStatuses = ["DRAFT", "LIVE", "LOCKED", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"];

  if (validStatuses.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid status
}

/**
 * Normalize application phase to match database constraint (uppercase)
 * Valid values: APPLIED, ACCEPTED, SCRIPT, WORK, PAYOUT, COMPLETED, CANCELLED
 * @param {string} phase - Application phase to normalize
 * @returns {string|null} - Normalized uppercase phase or null if invalid
 */
function normalizeApplicationPhase(phase) {
  if (!phase) return null;

  const normalized = String(phase).toUpperCase().trim();
  const validPhases = ["APPLIED", "ACCEPTED", "SCRIPT", "WORK", "PAYOUT", "COMPLETED", "CANCELLED"];

  if (validPhases.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid phase
}

/**
 * Normalize submission status to match database constraint (uppercase)
 * Valid values: PENDING, ACCEPTED, REVISION, REJECTED
 * @param {string} status - Submission status to normalize
 * @returns {string|null} - Normalized uppercase status or null if invalid
 */
function normalizeSubmissionStatus(status) {
  if (!status) return null;

  const normalized = String(status).toUpperCase().trim();
  const validStatuses = ["PENDING", "ACCEPTED", "REVISION", "REJECTED"];

  if (validStatuses.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid status
}

/**
 * Normalize role to match database constraint (uppercase)
 * Valid values: BRAND_OWNER, INFLUENCER, ADMIN
 * @param {string} role - Role to normalize
 * @returns {string|null} - Normalized uppercase role or null if invalid
 */
function normalizeRole(role) {
  if (!role) return null;

  const normalized = String(role).toUpperCase().trim();
  const validRoles = ["BRAND_OWNER", "INFLUENCER", "ADMIN"];

  if (validRoles.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid role
}

/**
 * Normalize data source to match database constraint (uppercase)
 * Valid values: MANUAL, GRAPH_API
 * @param {string} dataSource - Data source to normalize
 * @returns {string|null} - Normalized uppercase data source or null if invalid
 */
function normalizeDataSource(dataSource) {
  if (!dataSource) return null;

  const normalized = String(dataSource).toUpperCase().trim();
  const validDataSources = ["MANUAL", "GRAPH_API"];

  if (validDataSources.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid data source
}

/**
 * Normalize payout status to match database constraint (uppercase)
 * Valid values: PENDING, RELEASED, FAILED
 * @param {string} status - Payout status to normalize
 * @returns {string|null} - Normalized uppercase status or null if invalid
 */
function normalizePayoutStatus(status) {
  if (!status) return null;

  const normalized = String(status).toUpperCase().trim();
  const validStatuses = ["PENDING", "RELEASED", "FAILED"];

  if (validStatuses.includes(normalized)) {
    return normalized;
  }

  return null; // Invalid status
}

/**
 * Generic enum normalizer
 * @param {string} value - Value to normalize
 * @param {string[]} validValues - Array of valid enum values (should be uppercase)
 * @returns {string|null} - Normalized uppercase value or null if invalid
 */
function normalizeEnum(value, validValues) {
  if (!value || !Array.isArray(validValues) || validValues.length === 0) return null;

  const normalized = String(value).toUpperCase().trim();
  return validValues.includes(normalized) ? normalized : null;
}

/**
 * Validates if a value (case-insensitive) matches any of the valid enum values
 * @param {string} value - The value to validate
 * @param {string[]} validValues - Array of valid enum values (should be uppercase)
 * @returns {boolean} - True if value matches (case-insensitive)
 */
function isValidEnum(value, validValues) {
  if (!value || typeof value !== "string") return false;
  const normalized = String(value).toUpperCase().trim();
  return validValues.includes(normalized);
}

/**
 * Custom validator for express-validator that accepts any case
 * @param {string[]} validValues - Array of valid enum values (uppercase)
 * @param {string} errorMessage - Error message if validation fails
 * @returns {Function} - Express validator function
 */
function validateEnumCaseInsensitive(validValues, errorMessage) {
  return (value) => {
    if (value === undefined || value === null) return true; // Optional fields
    if (!isValidEnum(value, validValues)) {
      throw new Error(errorMessage);
    }
    return true;
  };
}

module.exports = {
  normalizeGender,
  normalizeTier,
  normalizePlatform,
  normalizeCampaignType,
  normalizePaymentStatus,
  normalizeCampaignStatus,
  normalizeApplicationPhase,
  normalizeSubmissionStatus,
  normalizeRole,
  normalizeDataSource,
  normalizePayoutStatus,
  normalizeEnum,
  isValidEnum,
  validateEnumCaseInsensitive,
};

