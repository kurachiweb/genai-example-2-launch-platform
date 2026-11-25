import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const YEAR_FINAL_DATE_UPDATE_ACTION = defineAuditAction({
  name: 'year-final-date.update',
  label: 'Yearトーナメント決勝実施日の変更',
  targetKind: 'setting',
  reason: 'optional',
  detailKeys: ['year', 'fromDate', 'toDate', 'fromSource'],
  maxTargets: 1,
});

export const TOURNAMENT_YEAR_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([YEAR_FINAL_DATE_UPDATE_ACTION]);
