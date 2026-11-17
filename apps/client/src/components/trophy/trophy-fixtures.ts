import type { ProductTrophyView } from './trophy-shelf-model.ts';

export const trophyOf = (
  overrides: Partial<ProductTrophyView> = {},
): ProductTrophyView => ({
  kind: 'WEEK',
  period: '2026-W37',
  periodLabel: '2026年第37週(9/7〜9/13)',
  awardedAt: '2026-09-19T07:40:00.000Z',
  bracketPath: '/tournaments/week/2026-W37',
  ...overrides,
});

// 業務時刻の2026-09-18の23:40に受賞した、2026年第37週のProduct of the Week
export const WEEK_37_TROPHY = trophyOf();

// 業務時刻の2026-11-13の23:40に受賞した、2026年第45週のProduct of the Week
export const WEEK_45_TROPHY = trophyOf({
  period: '2026-W45',
  periodLabel: '2026年第45週(11/2〜11/8)',
  awardedAt: '2026-11-14T07:40:00.000Z',
  bracketPath: '/tournaments/week/2026-W45',
});

// 業務時刻の2025-12-05の23:40に受賞した、前年の2025年第48週のProduct of the Week
export const WEEK_48_LAST_YEAR_TROPHY = trophyOf({
  period: '2025-W48',
  periodLabel: '2025年第48週(11/24〜11/30)',
  awardedAt: '2025-12-06T07:40:00.000Z',
  bracketPath: '/tournaments/week/2025-W48',
});

// 業務時刻の2026-01-10の23:40に受賞した、2025年のProduct of the Year
export const YEAR_2025_TROPHY = trophyOf({
  kind: 'YEAR',
  period: '2025',
  periodLabel: '2025年',
  awardedAt: '2026-01-11T07:40:00.000Z',
  bracketPath: '/tournaments/year/2025',
});
