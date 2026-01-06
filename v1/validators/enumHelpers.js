/**
 * Enum Validation Helpers
 * Provides case-insensitive validation for enum values
 */

/**
 * Validates if a value (case-insensitive) matches any of the valid enum values
 * @param {string} value - The value to validate
 * @param {string[]} validValues - Array of valid enum values (should be uppercase)
 * @returns {boolean} - True if value matches (case-insensitive)
 */
function isValidEnum(value, validValues) {
  if (!value || typeof value !== "string") return false;
  const normalized = value.toUpperCase().trim();
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

/**
 * Normalize enum value to uppercase
 * @param {string} value - The value to normalize
 * @param {string[]} validValues - Array of valid enum values
 * @returns {string|null} - Uppercase value or null if invalid
 */
function normalizeEnum(value, validValues) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.toUpperCase().trim();
  return validValues.includes(normalized) ? normalized : null;
}

module.exports = {
  isValidEnum,
  validateEnumCaseInsensitive,
  normalizeEnum,
};

