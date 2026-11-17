import type { WeekEntryPanelView } from './week-entry-model.ts';

export const WEEK_ENTRY_PRODUCT_HANDLE = 'pitch-deck';

export const WEEK_ENTRY_LAUNCH_ID = '01JD0WEEKENTRY000000000001';

export const WEEK_ENTRY_PURCHASE_ID = '01JD0WEEKPVRCHASE000000001';

// 2026年第47週の受付期限(翌週月曜日23:00、UTC-08:00)・決済期限(23:35)・組み合わせ決定(23:45)
export const WEEK_ENTRY_ACCEPT_UNTIL = '2026-11-24T07:00:00.000Z';

export const WEEK_ENTRY_DEADLINE_AT = '2026-11-24T07:35:00.000Z';

export const WEEK_ENTRY_DRAW_AT = '2026-11-24T07:45:00.000Z';

export const WEEK_ENTRY_BRACKET_PATH = '/tournaments/week/2026-W47';

const HOUR_MS = 3_600_000;

// 受付期限の何ミリ秒前かをサーバーの時刻にする
export const serverTimeBeforeAcceptUntil = (milliseconds: number): string =>
  new Date(Date.parse(WEEK_ENTRY_ACCEPT_UNTIL) - milliseconds).toISOString();

export const SERVER_TIME_THREE_DAYS_BEFORE = serverTimeBeforeAcceptUntil(
  72 * HOUR_MS,
);

export const SERVER_TIME_48_HOURS_BEFORE = serverTimeBeforeAcceptUntil(
  48 * HOUR_MS,
);

export const weekEntryOf = (
  overrides: Partial<WeekEntryPanelView> = {},
): WeekEntryPanelView => ({
  launchId: WEEK_ENTRY_LAUNCH_ID,
  week: '2026-W47',
  weekLabel: '2026年第47週(11/16〜11/22)',
  status: 'AWAITING_PAYMENT',
  closeReason: null,
  exempt: false,
  acceptUntil: WEEK_ENTRY_ACCEPT_UNTIL,
  deadlineAt: WEEK_ENTRY_DEADLINE_AT,
  drawAt: WEEK_ENTRY_DRAW_AT,
  fee: { amount: 500, currency: 'usd' },
  serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
  progress: null,
  bracketPath: null,
  ultrasGuide: true,
  ...overrides,
});

// 受付中の枠のうち決済を始められない状態の値(参加費・Ultrasの案内はサーバーが空にする)
const NOT_PAYABLE = Object.freeze({ fee: null, ultrasGuide: false });

export const EXEMPT_AWAITING_ENTRY = weekEntryOf({
  ...NOT_PAYABLE,
  exempt: true,
});

export const CLOSED_AWAITING_ENTRY = weekEntryOf({
  ...NOT_PAYABLE,
  serverTime: serverTimeBeforeAcceptUntil(-60_000),
});

export const PAID_ENTITLED_ENTRY = weekEntryOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
});

export const ULTRAS_ENTITLED_ENTRY = weekEntryOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
  exempt: true,
});

export const drawnEntryOf = (
  progress: NonNullable<WeekEntryPanelView['progress']>,
): WeekEntryPanelView =>
  weekEntryOf({
    ...NOT_PAYABLE,
    status: 'DRAWN',
    progress,
    bracketPath: WEEK_ENTRY_BRACKET_PATH,
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
  closeReason: NonNullable<WeekEntryPanelView['closeReason']>,
  exempt: boolean = false,
): WeekEntryPanelView =>
  weekEntryOf({ ...NOT_PAYABLE, status, closeReason, exempt });
