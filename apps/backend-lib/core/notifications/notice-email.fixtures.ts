import { parseBusinessDate } from '../time/business-time.ts';
import type {
  MatchNoticeView,
  NoticeEmailBuild,
  NoticeEmailContext,
} from './notice-email.ts';
import type {
  NoticeDraft,
  NoticeEmailPlan,
  PendingNotice,
} from './notice-plan.ts';
import {
  awardSlot,
  morningSlot,
  previewSlotFor,
  resultSlotFor,
} from './notification-slots.ts';
import type { ResultNoticeSupplement } from './result-notice-supplements.ts';

const TODAY = parseBusinessDate('2026-10-24');
const TOMORROW = parseBusinessDate('2026-10-25');

export const NOW = new Date('2026-10-25T07:50:00.000Z');
export const EVENT_ID = '01M7BNN5000000000000000001';
export const CLIENT_ORIGIN = 'https://launch.example';
export const EVENT_ORIGIN = 'https://event.launch.example';
export const OWNER = 'user-a';
export const FOLLOWER = 'user-f';

const tokenFrom = (offset: number): string =>
  new Uint8Array(64)
    .map((_value, index) => index + offset)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

export const RESULT_TOKEN = tokenFrom(0);
export const PREVIEW_TOKEN = tokenFrom(64);
export const FOLLOWED_MATCH_TOKEN = tokenFrom(128);
export const AWARD_TOKEN = tokenFrom(192);

export const SETTINGS_URL = 'https://launch.example/settings/notifications';
export const TOP_PAGE_URL = 'https://launch.example/';
export const MY_PRODUCTS_URL = 'https://launch.example/my/products';

type Entry = MatchNoticeView['entries'][number];

export function entry(side: string, overrides: Partial<Entry> = {}): Entry {
  return {
    entryId: `entry-${side}`,
    productId: `product-${side}`,
    ownerUserId: `user-${side}`,
    upvoteCount: 0,
    result: null,
    ...overrides,
  };
}

export const RESULT_MATCH: MatchNoticeView = {
  matchId: 'match-today',
  kind: 'qualifier',
  round: null,
  stage: null,
  startsAt: new Date('2026-10-24T08:00:00.000Z'),
  endsAt: new Date('2026-10-25T07:40:00.000Z'),
  phase: 'finished',
  decision: 'votes',
  entries: [
    entry('a', { upvoteCount: 12, result: 'won' }),
    entry('b', { upvoteCount: 9, result: 'lost' }),
  ],
};

export const NEXT_MATCH: MatchNoticeView = {
  matchId: 'match-next',
  kind: 'week',
  round: null,
  stage: 'semifinal',
  startsAt: new Date('2026-10-25T08:00:00.000Z'),
  endsAt: new Date('2026-10-26T07:40:00.000Z'),
  phase: 'scheduled',
  decision: null,
  entries: [entry('a', { entryId: 'entry-a-next' }), entry('c')],
};

export const LIVE_MATCH: MatchNoticeView = {
  matchId: 'match-live',
  kind: 'qualifier',
  round: null,
  stage: null,
  startsAt: new Date('2026-10-24T08:00:00.000Z'),
  endsAt: new Date('2026-10-25T07:40:00.000Z'),
  phase: 'live',
  decision: null,
  entries: [entry('b'), entry('d')],
};

export const EARLIER_LIVE_MATCH: MatchNoticeView = {
  matchId: 'match-live-week',
  kind: 'week',
  round: 2,
  stage: null,
  startsAt: new Date('2026-10-24T08:00:00.000Z'),
  endsAt: new Date('2026-10-25T06:00:00.000Z'),
  phase: 'live',
  decision: null,
  entries: [entry('e'), entry('c')],
};

const product = (name: string, handle: string, ownerUserId: string) => ({
  name,
  handle,
  ownerUserId,
});

export const PRODUCTS = new Map([
  ['product-a', product('Pitch Notes', 'pitch-notes', 'user-a')],
  ['product-b', product('Tactics Board', 'tactics-board', 'user-b')],
  ['product-c', product('Goal Line', 'goal-line', 'user-c')],
  ['product-d', product('Corner Kick', 'corner-kick', 'user-d')],
  ['product-e', product('Free Kick', 'free-kick', 'user-e')],
]);

export const MAKERS = new Map([
  ['user-a', { nickname: '山田' }],
  ['user-b', { nickname: '佐藤' }],
  ['user-c', { nickname: '鈴木' }],
  ['user-d', { nickname: '高橋' }],
  ['user-e', { nickname: '田中' }],
]);

export const SUPPLEMENT: ResultNoticeSupplement = {
  title: 'Weekトーナメントの参加費',
  lines: ['支払いの期限は10月26日07:40(UTC)です。'],
  emphasized: true,
};

export const PAY_ACTION = {
  label: '参加費を支払う',
  url: 'https://launch.example/my/products',
};

export function context(
  overrides: Partial<NoticeEmailContext> = {},
): NoticeEmailContext {
  return {
    contact: { email: 'someone@mail.example', nickname: '山田' },
    matches: new Map(
      [RESULT_MATCH, NEXT_MATCH, LIVE_MATCH, EARLIER_LIVE_MATCH].map(
        (match) => [match.matchId, match],
      ),
    ),
    products: PRODUCTS,
    makers: MAKERS,
    awards: new Map([
      [EVENT_ID, { award: 'product_of_the_week', period: '2026-W37' }],
    ]),
    tokens: new Map([
      [`${OWNER}:match_result`, RESULT_TOKEN],
      [`${OWNER}:match_preview`, PREVIEW_TOKEN],
      [`${FOLLOWER}:followed_user_match`, FOLLOWED_MATCH_TOKEN],
      [`${FOLLOWER}:followed_user_award`, AWARD_TOKEN],
    ]),
    supplements: new Map(),
    origins: { client: CLIENT_ORIGIN, event: EVENT_ORIGIN },
    now: NOW,
    ...overrides,
  };
}

export function withMatch(match: MatchNoticeView): NoticeEmailContext {
  const matches = new Map(context().matches);
  matches.set(match.matchId, match);
  return context({ matches });
}

export function withoutProduct(...productIds: string[]): NoticeEmailContext {
  return context({
    products: new Map(
      [...PRODUCTS].filter(([productId]) => !productIds.includes(productId)),
    ),
  });
}

export function withoutMaker(...userIds: string[]): NoticeEmailContext {
  return context({
    makers: new Map(
      [...MAKERS].filter(([userId]) => !userIds.includes(userId)),
    ),
  });
}

export function notice(
  noticeId: string,
  overrides: Partial<NoticeDraft> = {},
): PendingNotice {
  return {
    noticeId,
    topic: 'match_result',
    recipientUserId: OWNER,
    slot: resultSlotFor(TODAY),
    matchId: 'match-today',
    entryId: 'entry-a',
    productId: 'product-a',
    eventId: null,
    ...overrides,
  };
}

export const RESULT_NOTICE = notice('notice-result');

export const PREVIEW_NOTICE = notice('notice-preview', {
  topic: 'match_preview',
  slot: previewSlotFor(TOMORROW),
  matchId: 'match-next',
  entryId: 'entry-a-next',
});

export function followedNotice(
  noticeId: string,
  matchId: string,
  side: string,
): PendingNotice {
  return notice(noticeId, {
    topic: 'followed_user_match',
    recipientUserId: FOLLOWER,
    slot: morningSlot(TODAY),
    matchId,
    entryId: null,
    productId: `product-${side}`,
  });
}

export const AWARD_NOTICE = notice('notice-award', {
  topic: 'followed_user_award',
  recipientUserId: FOLLOWER,
  slot: awardSlot(EVENT_ID, NOW),
  matchId: null,
  entryId: null,
  productId: 'product-b',
  eventId: EVENT_ID,
});

export function previewPlan(
  preview: PendingNotice = PREVIEW_NOTICE,
): NoticeEmailPlan {
  return { kind: 'match-preview', recipientUserId: OWNER, preview };
}

export function resultPlan(
  preview: PendingNotice | null = null,
  result: PendingNotice = RESULT_NOTICE,
): NoticeEmailPlan {
  return { kind: 'match-result', recipientUserId: OWNER, result, preview };
}

export function matchesPlan(
  items: readonly PendingNotice[],
  omittedCount = 0,
): NoticeEmailPlan {
  return {
    kind: 'followed-user-matches',
    recipientUserId: FOLLOWER,
    items,
    omittedCount,
  };
}

export const AWARD_PLAN: NoticeEmailPlan = {
  kind: 'followed-user-award',
  recipientUserId: FOLLOWER,
  award: AWARD_NOTICE,
};

export type EmailBuild = Extract<NoticeEmailBuild, { kind: 'email' }>;

export function emailOf(build: NoticeEmailBuild): EmailBuild {
  if (build.kind !== 'email') {
    throw new Error(`メールを組み立てませんでした: ${JSON.stringify(build)}`);
  }
  return build;
}
