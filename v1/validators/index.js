/**
 * Validators Index
 * Exports all validation middleware for v1 API
 */

const otpValidators = require("./otpValidators");
const passwordValidators = require("./passwordValidators");
const profileValidators = require("./profileValidators");
const campaignValidators = require("./campaignValidators");
const applicationValidators = require("./applicationValidators");
const paymentValidators = require("./paymentValidators");

module.exports = {
  // OTP Authentication validators
  ...otpValidators,
  // Password Authentication validators
  ...passwordValidators,
  // Profile Management validators
  ...profileValidators,
  // Campaign Management validators
  ...campaignValidators,
  // Application Management validators
  ...applicationValidators,
  // Payment Management validators
  ...paymentValidators,
};
