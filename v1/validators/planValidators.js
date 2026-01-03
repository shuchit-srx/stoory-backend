const { body, param } = require("express-validator");

/**
 * Plan Validators
 * Validation rules for plan operations
 */

const validateCreatePlan = [
  body("name")
    .notEmpty()
    .withMessage("name is required")
    .isString()
    .withMessage("name must be a string")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("name must be between 1 and 200 characters"),

  body("features")
    .optional()
    .isObject()
    .withMessage("features must be an object"),

  body("price")
    .notEmpty()
    .withMessage("price is required")
    .isFloat({ min: 0 })
    .withMessage("price must be a non-negative number"),

  body("billing_cycle")
    .notEmpty()
    .withMessage("billing_cycle is required")
    .isString()
    .isIn(["MONTHLY", "YEARLY", "monthly", "yearly"])
    .withMessage("billing_cycle must be MONTHLY or YEARLY"),

  body("is_active")
    .optional()
    .isBoolean()
    .withMessage("is_active must be a boolean"),
];

const validateUpdatePlan = [
  param("id")
    .notEmpty()
    .withMessage("Plan ID is required")
    .isUUID()
    .withMessage("Plan ID must be a valid UUID"),

  body("name")
    .optional()
    .isString()
    .withMessage("name must be a string")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("name must be between 1 and 200 characters"),

  body("features")
    .optional()
    .isObject()
    .withMessage("features must be an object"),

  body("price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("price must be a non-negative number"),

  body("billing_cycle")
    .optional()
    .isString()
    .isIn(["MONTHLY", "YEARLY", "monthly", "yearly"])
    .withMessage("billing_cycle must be MONTHLY or YEARLY"),

  body("is_active")
    .optional()
    .isBoolean()
    .withMessage("is_active must be a boolean"),
];

module.exports = {
  validateCreatePlan,
  validateUpdatePlan,
};

