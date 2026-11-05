export const PURCHASE_KINDS = Object.freeze([
  'week_tournament_entry',
  'year_tournament_entry',
  'sponsorship',
  'ultras',
  'payments_smoke',
] as const);

export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

export type PurchaseMode = 'payment' | 'subscription';

export const PURCHASE_KIND_MODES: Readonly<Record<PurchaseKind, PurchaseMode>> =
  Object.freeze({
    week_tournament_entry: 'payment',
    year_tournament_entry: 'payment',
    sponsorship: 'payment',
    ultras: 'subscription',
    payments_smoke: 'payment',
  });

export const PURCHASE_KIND_LABELS: Readonly<Record<PurchaseKind, string>> =
  Object.freeze({
    week_tournament_entry: 'Weekトーナメント参加費',
    year_tournament_entry: 'Yearトーナメント参加費',
    sponsorship: 'スポンサー広告',
    ultras: 'Ultrasプラン',
    payments_smoke: '決済の疎通確認',
  });
