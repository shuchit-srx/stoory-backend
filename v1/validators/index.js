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
const mouValidators = require("./mouValidators");
const fcmValidators = require("./fcmValidators");
const portfolioValidators = require("./portfolioValidators");
const panValidators = require("./panValidators");

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
  // MOU Management validators
  ...mouValidators,
  // FCM Token Management validators
  ...fcmValidators,
  // Portfolio Management validators
  ...portfolioValidators,
  // PAN Verification validators
  ...panValidators,
};
