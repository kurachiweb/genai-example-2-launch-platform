import type { AuditActionDefinition } from '../audit-action.ts';
import { ADMIN_FOUNDATION_AUDIT_ACTIONS } from './admin-foundation.ts';
import { HELP_CENTER_AUDIT_ACTIONS } from './help-center.ts';
import { INQUIRY_AUDIT_ACTIONS } from './inquiry-chat.ts';
import { NOTIFICATION_AUDIT_ACTIONS } from './notifications.ts';
import { PRODUCT_LAUNCH_AUDIT_ACTIONS } from './product-launch.ts';
import { SPONSORSHIP_AUDIT_ACTIONS } from './sponsorship.ts';
import { TOURNAMENT_YEAR_AUDIT_ACTIONS } from './tournament-year.ts';
import { MODERATION_AUDIT_ACTIONS } from './ugc-moderation.ts';
import { ULTRAS_AUDIT_ACTIONS } from './ultras-subscription.ts';

export const AUDIT_ACTIONS: readonly AuditActionDefinition[] = Object.freeze([
  ...ADMIN_FOUNDATION_AUDIT_ACTIONS,
  ...INQUIRY_AUDIT_ACTIONS,
  ...ULTRAS_AUDIT_ACTIONS,
  ...PRODUCT_LAUNCH_AUDIT_ACTIONS,
  ...HELP_CENTER_AUDIT_ACTIONS,
  ...NOTIFICATION_AUDIT_ACTIONS,
  ...TOURNAMENT_YEAR_AUDIT_ACTIONS,
  ...SPONSORSHIP_AUDIT_ACTIONS,
  ...MODERATION_AUDIT_ACTIONS,
]);
