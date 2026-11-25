import {
  MODERATION_ACTION_DEFINITIONS,
  MODERATION_ACTIONS,
  type ModerationAction,
} from '../../moderation/moderation-actions.ts';
import { MODERATION_ACTION_LABELS } from '../../moderation/moderation-labels.ts';
import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

const defineModerationAuditAction = (
  action: ModerationAction,
): AuditActionDefinition => {
  const { targetKind, reason } = MODERATION_ACTION_DEFINITIONS[action];
  return defineAuditAction({
    name: action,
    label: MODERATION_ACTION_LABELS[action],
    targetKind,
    reason,
    detailKeys: [],
    maxTargets: 1,
  });
};

export const MODERATION_AUDIT_ACTION_DEFINITIONS: Readonly<
  Record<ModerationAction, AuditActionDefinition>
> = Object.freeze({
  'user.suspend': defineModerationAuditAction('user.suspend'),
  'user.unsuspend': defineModerationAuditAction('user.unsuspend'),
  'user.administrative-withdraw': defineModerationAuditAction(
    'user.administrative-withdraw',
  ),
  'product.hide': defineModerationAuditAction('product.hide'),
  'product.unhide': defineModerationAuditAction('product.unhide'),
  'comment.hide': defineModerationAuditAction('comment.hide'),
  'comment.unhide': defineModerationAuditAction('comment.unhide'),
  'rating.invalidate': defineModerationAuditAction('rating.invalidate'),
  'rating.revalidate': defineModerationAuditAction('rating.revalidate'),
  'image.approve': defineModerationAuditAction('image.approve'),
  'image.quarantine': defineModerationAuditAction('image.quarantine'),
  'image.release': defineModerationAuditAction('image.release'),
  'image.delete': defineModerationAuditAction('image.delete'),
});

export const MODERATION_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze(
    MODERATION_ACTIONS.map(
      (action) => MODERATION_AUDIT_ACTION_DEFINITIONS[action],
    ),
  );
