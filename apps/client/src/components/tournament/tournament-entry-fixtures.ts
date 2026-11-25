import type {
  TournamentEntryCopy,
  TournamentEntryExcludedReason,
} from './tournament-copy.ts';
import type { TournamentEntryInput } from './tournament-entry-model.ts';

export const ENTRY_LAUNCH_ID = '01JD0TESTENTRY000000000001';

export const ENTRY_PURCHASE_ID = '01JD0TESTPVRCHASE000000001';

// 受付期限(23:00、UTC-08:00)と組み合わせ決定(23:45)
export const ENTRY_ACCEPT_UNTIL = '2026-11-24T07:00:00.000Z';

export const ENTRY_DRAW_AT = '2026-11-24T07:45:00.000Z';

export const ENTRY_BRACKET_PATH = '/tournaments/test/2026';

const HOUR_MS = 3_600_000;

// 受付期限の何ミリ秒前かをサーバーの時刻にする
export const serverTimeBeforeAcceptUntil = (milliseconds: number): string =>
  new Date(Date.parse(ENTRY_ACCEPT_UNTIL) - milliseconds).toISOString();

export const SERVER_TIME_THREE_DAYS_BEFORE = serverTimeBeforeAcceptUntil(
  72 * HOUR_MS,
);

export const SERVER_TIME_48_HOURS_BEFORE = serverTimeBeforeAcceptUntil(
  48 * HOUR_MS,
);

export const ENTRY_TITLE = 'Product of the Testトーナメント';

export const ENTRY_BUTTON_LABEL = 'Testトーナメントに参加';

export const ENTRY_EXEMPT_MESSAGE =
  'Ultrasの特典によりTestトーナメントの参加資格を得ています。';

export const ENTRY_CLOSED_MESSAGE =
  'Testトーナメントの参加受付は終了しました。';

export const ENTRY_DRAWN_MESSAGE = 'Testの組み合わせに参加しています。';

export const ENTRY_CHAMPION_MESSAGE = 'Product of the Testを受賞しました。';

export const ENTRY_FORFEITED_MESSAGE = 'Testの参加資格を失いました。';

export const ENTRY_FORFEITED_REFUND_SUFFIX = 'Testの参加費は全額返金されます。';

export const ENTRY_EXCLUDED_REFUND_SUFFIX = 'Testの参加費は返金されます。';

export const ENTRY_COPY: TournamentEntryCopy = Object.freeze({
  title: ENTRY_TITLE,
  entryButton: ENTRY_BUTTON_LABEL,
  exemptMessage: ENTRY_EXEMPT_MESSAGE,
  closedMessage: ENTRY_CLOSED_MESSAGE,
  entitledMessage: Object.freeze({
    lead: 'Testの参加資格を得ました。',
    before: '組み合わせの決定は',
    after: 'です。',
  }),
  drawnMessage: ENTRY_DRAWN_MESSAGE,
  championMessage: ENTRY_CHAMPION_MESSAGE,
  eliminatedMessage: (roundName: string) => `Testの${roundName}で敗退。`,
  expiredMessage: (late: boolean) =>
    late ? 'Testの組み合わせ決定に間に合いませんでした。' : 'Testの期限切れ。',
  forfeitedMessage: ENTRY_FORFEITED_MESSAGE,
  forfeitedRefundSuffix: ENTRY_FORFEITED_REFUND_SUFFIX,
  excludedMessage: (reason: TournamentEntryExcludedReason) =>
    reason === 'over_capacity'
      ? 'Testの参加数の上限により除外されました。'
      : 'Testのプロダクトが公開されていないため除外されました。',
  excludedRefundSuffix: ENTRY_EXCLUDED_REFUND_SUFFIX,
});

export const entryInputOf = (
  overrides: Partial<TournamentEntryInput> = {},
): TournamentEntryInput => ({
  launchId: ENTRY_LAUNCH_ID,
  status: 'AWAITING_PAYMENT',
  late: false,
  excludedReason: null,
  exempt: false,
  refundable: false,
  acceptUntil: ENTRY_ACCEPT_UNTIL,
  drawAt: ENTRY_DRAW_AT,
  serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
  feeAmount: 500,
  ultrasGuide: true,
  blockedReason: null,
  progress: null,
  bracketPath: null,
  ...overrides,
});

export const PRODUCT_UNAVAILABLE_MESSAGE =
  'このプロダクトは現在Testトーナメントに参加できません。';

// 受付中で受付期限の前だが、プロダクトを非公開化している間の枠
export const PRODUCT_UNAVAILABLE_ENTRY = entryInputOf({
  blockedReason: PRODUCT_UNAVAILABLE_MESSAGE,
});

// 受付中の枠のうち決済を始められない状態の値
const NOT_PAYABLE = Object.freeze({ feeAmount: null, ultrasGuide: false });

export const EXEMPT_AWAITING_ENTRY = entryInputOf({
  ...NOT_PAYABLE,
  exempt: true,
});

export const CLOSED_AWAITING_ENTRY = entryInputOf({
  ...NOT_PAYABLE,
  serverTime: serverTimeBeforeAcceptUntil(-60_000),
});

export const PAID_ENTITLED_ENTRY = entryInputOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
});

export const ULTRAS_ENTITLED_ENTRY = entryInputOf({
  ...NOT_PAYABLE,
  status: 'ENTITLED',
  exempt: true,
});

export const drawnEntryOf = (
  progress: NonNullable<TournamentEntryInput['progress']>,
): TournamentEntryInput =>
  entryInputOf({
    ...NOT_PAYABLE,
    status: 'DRAWN',
    progress,
    bracketPath: ENTRY_BRACKET_PATH,
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

export const expiredEntryOf = (late: boolean): TournamentEntryInput =>
  entryInputOf({ ...NOT_PAYABLE, status: 'EXPIRED', late });

export const forfeitedEntryOf = (refundable: boolean): TournamentEntryInput =>
  entryInputOf({ ...NOT_PAYABLE, status: 'FORFEITED', refundable });

export const excludedEntryOf = (
  refundable: boolean,
  excludedReason: TournamentEntryInput['excludedReason'] = 'hidden_or_suspended',
): TournamentEntryInput =>
  entryInputOf({
    ...NOT_PAYABLE,
    status: 'EXCLUDED',
    refundable,
    excludedReason,
  });
