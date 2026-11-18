import type { YearEntryPanelView } from './year-entry-view.ts';

export const YEAR_ENTRY_PRODUCT_HANDLE = 'pitch-deck';

export const YEAR_ENTRY_LAUNCH_ID = '01JD0YEARENTRY000000000001';

export const YEAR_ENTRY_PURCHASE_ID = '01JD0YEARPVRCHASE000000001';

export const YEAR_ENTRY_YEAR_LABEL = '2027年';

export const YEAR_ENTRY_WEEK_LABEL = '2026年第47週(11/16〜11/22)';

// 2027年の決勝の業務日付(5月の最終日曜日)
export const YEAR_ENTRY_FINAL_DATE = '2027-05-30';

// 決勝の6日前の受付期限(23:00、UTC-08:00)・決済期限(23:35)・組み合わせ決定(23:45)
export const YEAR_ENTRY_ACCEPT_UNTIL = '2027-05-25T07:00:00.000Z';

export const YEAR_ENTRY_DEADLINE_AT = '2027-05-25T07:35:00.000Z';

export const YEAR_ENTRY_DRAW_AT = '2027-05-25T07:45:00.000Z';

export const YEAR_ENTRY_BRACKET_PATH = '/tournaments/year/2027';

const HOUR_MS = 3_600_000;

// 受付期限の何ミリ秒前かをサーバーの時刻にする
export const serverTimeBeforeAcceptUntil = (milliseconds: number): string =>
  new Date(Date.parse(YEAR_ENTRY_ACCEPT_UNTIL) - milliseconds).toISOString();

export const SERVER_TIME_THREE_DAYS_BEFORE = serverTimeBeforeAcceptUntil(
  72 * HOUR_MS,
);

export const yearEntryOf = (
  overrides: Partial<YearEntryPanelView> = {},
): YearEntryPanelView => ({
  launchId: YEAR_ENTRY_LAUNCH_ID,
  year: 2027,
  yearLabel: YEAR_ENTRY_YEAR_LABEL,
  weekLabel: YEAR_ENTRY_WEEK_LABEL,
  finalDate: YEAR_ENTRY_FINAL_DATE,
  status: 'AWAITING_PAYMENT',
  closeReason: null,
  exempt: false,
  refundable: false,
  acceptUntil: YEAR_ENTRY_ACCEPT_UNTIL,
  deadlineAt: YEAR_ENTRY_DEADLINE_AT,
  drawAt: YEAR_ENTRY_DRAW_AT,
  fee: { amount: 2000, currency: 'usd' },
  serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
  progress: null,
  bracketPath: null,
  ...overrides,
});

// 受付中の枠のうち決済を始められない状態の値(参加費はサーバーが空にする)
const NOT_PAYABLE = Object.freeze({ fee: null });

export const EXEMPT_AWAITING_ENTRY = yearEntryOf({
  ...NOT_PAYABLE,
  exempt: true,
});

export const CLOSED_AWAITING_ENTRY = yearEntryOf({
  ...NOT_PAYABLE,
  serverTime: serverTimeBeforeAcceptUntil(-60_000),
});

export const PAID_ENTITLED_ENTRY = yearEntryOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
});

export const ULTRAS_ENTITLED_ENTRY = yearEntryOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
  exempt: true,
});

export const drawnEntryOf = (
  progress: NonNullable<YearEntryPanelView['progress']>,
): YearEntryPanelView =>
  yearEntryOf({
    ...NOT_PAYABLE,
    status: 'DRAWN',
    progress,
    bracketPath: YEAR_ENTRY_BRACKET_PATH,
  });

export const ALIVE_ENTRY = drawnEntryOf({
  alive: true,
  champion: false,
  eliminatedRoundName: null,
});

export const ELIMINATED_ENTRY = drawnEntryOf({
  alive: false,
  champion: false,
  eliminatedRoundName: '準決勝',
});

export const CHAMPION_ENTRY = drawnEntryOf({
  alive: false,
  champion: true,
  eliminatedRoundName: null,
});

export const closedEntryOf = (
  status: 'EXPIRED' | 'FORFEITED' | 'EXCLUDED',
  closeReason: NonNullable<YearEntryPanelView['closeReason']>,
  refundable: boolean = false,
): YearEntryPanelView =>
  yearEntryOf({ ...NOT_PAYABLE, status, closeReason, refundable });
