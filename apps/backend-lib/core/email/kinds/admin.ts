import { z } from 'zod';

import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema } from './link-url.ts';

const nickname = z.string().min(1);

const utcDateTime = z.iso.datetime();

const invitationInput = z.object({
  invitationUrl: linkUrlSchema,
  expiresAt: utcDateTime,
});

const emailChangeConfirmationInput = z.object({
  nickname,
  confirmUrl: linkUrlSchema,
  expiresAt: utcDateTime,
});

const passwordResetInput = z.object({
  nickname,
  resetUrl: linkUrlSchema,
  expiresAt: utcDateTime,
});

const changedInput = z.object({
  nickname,
  changedAt: utcDateTime,
});

const passwordResetCompletedInput = z.object({
  nickname,
  completedAt: utcDateTime,
});

export type AdminInvitationInput = z.infer<typeof invitationInput>;

export type AdminEmailChangeConfirmationInput = z.infer<
  typeof emailChangeConfirmationInput
>;

export type AdminPasswordResetInput = z.infer<typeof passwordResetInput>;

export type AdminChangedInput = z.infer<typeof changedInput>;

export type AdminPasswordResetCompletedInput = z.infer<
  typeof passwordResetCompletedInput
>;

export const ADMIN_INVITATION_KIND = defineEmailKind({
  name: 'admin.invitation',
  category: 'transactional',
  inputSchema: invitationInput,
});

export const ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND = defineEmailKind({
  name: 'admin.email-change-confirmation',
  category: 'transactional',
  inputSchema: emailChangeConfirmationInput,
});

export const ADMIN_EMAIL_CHANGED_KIND = defineEmailKind({
  name: 'admin.email-changed',
  category: 'transactional',
  inputSchema: changedInput,
});

export const ADMIN_PASSWORD_RESET_KIND = defineEmailKind({
  name: 'admin.password-reset',
  category: 'transactional',
  inputSchema: passwordResetInput,
});

export const ADMIN_PASSWORD_RESET_COMPLETED_KIND = defineEmailKind({
  name: 'admin.password-reset-completed',
  category: 'transactional',
  inputSchema: passwordResetCompletedInput,
});

export const ADMIN_PASSWORD_CHANGED_KIND = defineEmailKind({
  name: 'admin.password-changed',
  category: 'transactional',
  inputSchema: changedInput,
});

export const ADMIN_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  ADMIN_INVITATION_KIND,
  ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
  ADMIN_EMAIL_CHANGED_KIND,
  ADMIN_PASSWORD_RESET_KIND,
  ADMIN_PASSWORD_RESET_COMPLETED_KIND,
  ADMIN_PASSWORD_CHANGED_KIND,
]);
