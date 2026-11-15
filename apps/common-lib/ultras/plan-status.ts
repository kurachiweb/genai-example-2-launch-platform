export const ULTRAS_PLAN_STATUSES = Object.freeze([
  'active',
  'past_due',
  'canceled',
  'ended',
] as const);

export type UltrasPlanStatus = (typeof ULTRAS_PLAN_STATUSES)[number];

export const ULTRAS_PLAN_STATUS_LABELS: Readonly<
  Record<UltrasPlanStatus, string>
> = Object.freeze({
  active: '有効',
  past_due: '支払いの再試行中',
  canceled: '解約済み',
  ended: '終了',
});

export const ULTRAS_ENTITLED_STATUSES: readonly UltrasPlanStatus[] =
  Object.freeze(['active', 'past_due', 'canceled'] as const);

export const ULTRAS_PRICE_LOOKUP_KEY = 'ultras_monthly';
