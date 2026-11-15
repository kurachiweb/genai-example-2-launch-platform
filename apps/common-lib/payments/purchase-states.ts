export const PURCHASE_STATUSES = Object.freeze([
  'open',
  'processing',
  'fulfilled',
  'rejected',
  'expired',
  'superseded',
] as const);

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const REJECTION_REASONS = Object.freeze([
  'late',
  'ineligible',
  'duplicate',
] as const);

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REFUND_REQUEST_STATUSES = Object.freeze([
  'requested',
  'submitted',
  'succeeded',
  'failed',
  'canceled',
] as const);

export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

export const EMAIL_REQUEST_STATUSES = Object.freeze([
  'none',
  'pending',
  'requested',
  'skipped',
] as const);

export type EmailRequestStatus = (typeof EMAIL_REQUEST_STATUSES)[number];
