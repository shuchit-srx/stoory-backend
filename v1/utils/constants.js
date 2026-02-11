/**
 * Application-wide constants
 * Centralized definitions to avoid magic strings and reduce typos
 */

const CampaignStatus = {
  DRAFT: "DRAFT",
  LIVE: "LIVE",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const CampaignType = {
  NORMAL: "NORMAL",
  BULK: "BULK",
};

const ApplicationPhase = {
  APPLIED: "APPLIED",
  ACCEPTED: "ACCEPTED",
  SCRIPT: "SCRIPT",
  WORK: "WORK",
  PAYOUT: "PAYOUT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const SubmissionStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REVISION: "REVISION",
  REJECTED: "REJECTED",
};

const PaymentStatus = {
  CREATED: "CREATED",
  PROCESSING: "PROCESSING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

const PayoutStatus = {
  PENDING: "PENDING",
  RELEASED: "RELEASED",
  FAILED: "FAILED",
};

// Valid status arrays for validation
const VALID_CAMPAIGN_STATUSES = Object.values(CampaignStatus);
const VALID_CAMPAIGN_TYPES = Object.values(CampaignType);
const VALID_APPLICATION_PHASES = Object.values(ApplicationPhase);
const VALID_SUBMISSION_STATUSES = Object.values(SubmissionStatus);
const VALID_PAYMENT_STATUSES = Object.values(PaymentStatus);
const VALID_PAYOUT_STATUSES = Object.values(PayoutStatus);

module.exports = {
  CampaignStatus,
  CampaignType,
  ApplicationPhase,
  SubmissionStatus,
  PaymentStatus,
  PayoutStatus,
  VALID_CAMPAIGN_STATUSES,
  VALID_CAMPAIGN_TYPES,
  VALID_APPLICATION_PHASES,
  VALID_SUBMISSION_STATUSES,
  VALID_PAYMENT_STATUSES,
  VALID_PAYOUT_STATUSES,
};

