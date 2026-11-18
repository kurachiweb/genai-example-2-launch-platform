import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const SPONSORSHIP_TERMINATE_ACTION = defineAuditAction({
  name: 'sponsorship.terminate',
  label: 'スポンサー広告の強制終了',
  targetKind: 'sponsorship',
  reason: 'required',
  detailKeys: [
    'unexposedDays',
    'refundEstimate',
    'stoppedDays',
    'stopRefundAmount',
  ],
  maxTargets: 1,
});

export const SPONSORSHIP_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([SPONSORSHIP_TERMINATE_ACTION]);
