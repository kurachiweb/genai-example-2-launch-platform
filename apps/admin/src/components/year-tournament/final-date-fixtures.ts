import type { AdminYearFinalDateSetting } from '../../graphql/admin-year-final-date.ts';

// 2026年11月の画面の現在の年。決勝(5月の最終日曜日)の変更期限を過ぎている
export const CURRENT_YEAR_SETTING: AdminYearFinalDateSetting = Object.freeze({
  year: 2026,
  finalDate: '2026-05-31',
  source: 'DEFAULT',
  acceptUntil: '2026-05-26T07:00:00.000Z',
  deadlineAt: '2026-05-26T07:35:00.000Z',
  drawAt: '2026-05-26T07:45:00.000Z',
  changeLockAt: '2026-05-24T08:00:00.000Z',
  changeable: false,
  choices: [],
  previousYearFinalDate: null,
  nextYearFinalDate: '2027-05-30',
  nextYearSource: 'EXPLICIT',
  nextYearGapWarningDate: null,
  version: 0,
  updatedAt: null,
  updatedBy: null,
});

// 翌年。最上位管理者が設定した日で、変更期限の前
export const NEXT_YEAR_SETTING: AdminYearFinalDateSetting = Object.freeze({
  year: 2027,
  finalDate: '2027-05-30',
  source: 'EXPLICIT',
  acceptUntil: '2027-05-25T07:00:00.000Z',
  deadlineAt: '2027-05-25T07:35:00.000Z',
  drawAt: '2027-05-25T07:45:00.000Z',
  changeLockAt: '2027-05-23T08:00:00.000Z',
  changeable: true,
  choices: ['2027-05-23', '2027-05-30', '2027-06-06'],
  previousYearFinalDate: '2026-05-31',
  nextYearFinalDate: '2028-05-28',
  nextYearSource: 'DEFAULT',
  nextYearGapWarningDate: null,
  version: 2,
  updatedAt: '2026-11-05T01:02:03.000Z',
  updatedBy: { nickname: '統括の担当' },
});

export const settingOf = (
  overrides: Partial<AdminYearFinalDateSetting> = {},
): AdminYearFinalDateSetting => ({ ...NEXT_YEAR_SETTING, ...overrides });
