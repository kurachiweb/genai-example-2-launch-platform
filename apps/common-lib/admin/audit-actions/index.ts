import type { AuditActionDefinition } from '../audit-action.ts';
import { ADMIN_FOUNDATION_AUDIT_ACTIONS } from './admin-foundation.ts';
import { INQUIRY_AUDIT_ACTIONS } from './inquiry-chat.ts';
import { PRODUCT_LAUNCH_AUDIT_ACTIONS } from './product-launch.ts';
import { ULTRAS_AUDIT_ACTIONS } from './ultras-subscription.ts';

export const AUDIT_ACTIONS: readonly AuditActionDefinition[] = Object.freeze([
  ...ADMIN_FOUNDATION_AUDIT_ACTIONS,
  ...INQUIRY_AUDIT_ACTIONS,
  ...ULTRAS_AUDIT_ACTIONS,
  ...PRODUCT_LAUNCH_AUDIT_ACTIONS,
]);
