import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const ULTRAS_PROMOTION_UPDATE_ACTION = defineAuditAction({
  name: 'ultras-promotion.update',
  label: 'Ultras導線の機能フラグの変更',
  targetKind: 'setting',
  reason: 'optional',
  detailKeys: ['enabled'],
  maxTargets: 1,
});

export const ULTRAS_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([ULTRAS_PROMOTION_UPDATE_ACTION]);
