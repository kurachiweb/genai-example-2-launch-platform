import { z } from 'zod';

import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const nickname = z.string().min(1);

const utcDateTime = z.iso.datetime();

const emailVerificationInput = z.object({
  nickname,
  verifyUrl: linkUrl,
  expiresAt: utcDateTime,
});

const confirmationInput = z.object({
  nickname,
  confirmUrl: linkUrl,
  expiresAt: utcDateTime,
});

const changedInput = z.object({
  nickname,
  changedAt: utcDateTime,
  contactUrl: linkUrl,
});

const passwordResetInput = z.object({
  nickname,
  resetUrl: linkUrl,
  expiresAt: utcDateTime,
});

const passwordResetCompletedInput = z.object({
  nickname,
  completedAt: utcDateTime,
  contactUrl: linkUrl,
});

export type EmailVerificationInput = z.infer<typeof emailVerificationInput>;

export type IdentityConfirmationInput = z.infer<typeof confirmationInput>;

export type IdentityChangedInput = z.infer<typeof changedInput>;

export type PasswordResetInput = z.infer<typeof passwordResetInput>;

export type PasswordResetCompletedInput = z.infer<
  typeof passwordResetCompletedInput
>;

export const IDENTITY_EMAIL_VERIFICATION_KIND = defineEmailKind({
  name: 'identity.email-verification',
  category: 'transactional',
  inputSchema: emailVerificationInput,
});

export const IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND = defineEmailKind({
  name: 'identity.email-change-confirmation',
  category: 'transactional',
  inputSchema: confirmationInput,
});

export const IDENTITY_EMAIL_CHANGED_KIND = defineEmailKind({
  name: 'identity.email-changed',
  category: 'transactional',
  inputSchema: changedInput,
});

export const IDENTITY_PASSWORD_RESET_KIND = defineEmailKind({
  name: 'identity.password-reset',
  category: 'transactional',
  inputSchema: passwordResetInput,
});

export const IDENTITY_PASSWORD_RESET_COMPLETED_KIND = defineEmailKind({
  name: 'identity.password-reset-completed',
  category: 'transactional',
  inputSchema: passwordResetCompletedInput,
});

export const IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND = defineEmailKind({
  name: 'identity.password-change-confirmation',
  category: 'transactional',
  inputSchema: confirmationInput,
});

export const IDENTITY_PASSWORD_CHANGED_KIND = defineEmailKind({
  name: 'identity.password-changed',
  category: 'transactional',
  inputSchema: changedInput,
});

export const IDENTITY_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  IDENTITY_EMAIL_VERIFICATION_KIND,
  IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
  IDENTITY_EMAIL_CHANGED_KIND,
  IDENTITY_PASSWORD_RESET_KIND,
  IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
  IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
  IDENTITY_PASSWORD_CHANGED_KIND,
]);
