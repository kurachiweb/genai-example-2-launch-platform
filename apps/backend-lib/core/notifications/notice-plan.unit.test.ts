import { describe, expect, test } from 'bun:test';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { parseBusinessDate } from '../time/business-time.ts';
import {
  DIGEST_ITEM_LIMIT,
  groupKeyFor,
  type MatchNoticeSource,
  matchNoticeDrafts,
  type NoticeDraft,
  noticeDedupeKey,
  type PendingNotice,
  planGroupEmail,
} from './notice-plan.ts';
import {
  awardSlot,
  morningSlot,
  previewSlotFor,
  resultSlotFor,
} from './notification-slots.ts';

const TODAY = parseBusinessDate('2026-10-24');
const TOMORROW = parseBusinessDate('2026-10-25');
const EVENT_ID = '01M7BNN5000000000000000001';
const EXPANDED_AT = new Date('2026-10-25T03:00:00.000Z');
const ALL_TOPICS: ReadonlySet<NotificationTopic> = new Set([
  'match_preview',
  'match_result',
  'followed_user_match',
  'followed_user_award',
]);

function entry(
  side: string,
  overrides: Partial<MatchNoticeSource['entries'][number]> = {},
): MatchNoticeSource['entries'][number] {
  return {
    entryId: `entry-${side}`,
    productId: `product-${side}`,
    ownerUserId: `user-${side}`,
    ...overrides,
  };
}

function match(overrides: Partial<MatchNoticeSource> = {}): MatchNoticeSource {
  return {
    matchId: 'match-1',
    matchDate: TOMORROW,
    phase: 'scheduled',
    decided: false,
    entries: [entry('a'), entry('b')],
    ...overrides,
  };
}

function draft(overrides: Partial<NoticeDraft> = {}): NoticeDraft {
  return {
    topic: 'match_result',
    recipientUserId: 'user-a',
    slot: resultSlotFor(TODAY),
    matchId: 'match-1',
    entryId: 'entry-a',
    productId: 'product-a',
    eventId: null,
    ...overrides,
  };
}

function pending(
  noticeId: string,
  overrides: Partial<NoticeDraft> = {},
): PendingNotice {
  return { noticeId, ...draft(overrides) };
}

const ELIGIBLE: ReadonlySet<string> = new Set(['user-a', 'user-b']);

describe('matchNoticeDrafts', () => {
  test('開始予告は側が2つの予定のマッチの投稿者ごとに、前日の夜の枠へ作る', () => {
    const drafts = matchNoticeDrafts({
      topic: 'match_preview',
      matches: [match()],
      eligible: ELIGIBLE,
    });

    expect(drafts).toEqual([
      {
        topic: 'match_preview',
        recipientUserId: 'user-a',
        slot: previewSlotFor(TOMORROW),
        matchId: 'match-1',
        entryId: 'entry-a',
        productId: 'product-a',
        eventId: null,
      },
      {
        topic: 'match_preview',
        recipientUserId: 'user-b',
        slot: previewSlotFor(TOMORROW),
        matchId: 'match-1',
        entryId: 'entry-b',
        productId: 'product-b',
        eventId: null,
      },
    ]);
    expect(drafts[0]?.slot.key).toBe('evening:2026-10-24');
  });

  test('対戦相手のいないマッチ(不戦勝)には開始予告を作らない', () => {
    expect(
      matchNoticeDrafts({
        topic: 'match_preview',
        matches: [match({ entries: [entry('a')] })],
        eligible: ELIGIBLE,
      }),
    ).toEqual([]);
  });

  test.each(['live', 'tallying', 'finished'] as const)(
    '段階が%sのマッチには開始予告を作らない',
    (phase) => {
      expect(
        matchNoticeDrafts({
          topic: 'match_preview',
          matches: [match({ phase })],
          eligible: ELIGIBLE,
        }),
      ).toEqual([]);
    },
  );

  test('勝敗結果は確定したマッチだけに、当日の夜の枠へ作る', () => {
    const drafts = matchNoticeDrafts({
      topic: 'match_result',
      matches: [
        match({
          matchId: 'match-decided',
          matchDate: TODAY,
          phase: 'finished',
          decided: true,
        }),
        match({
          matchId: 'match-tallying',
          matchDate: TODAY,
          phase: 'tallying',
          decided: false,
        }),
      ],
      eligible: ELIGIBLE,
    });

    expect(drafts.map((item) => [item.matchId, item.recipientUserId])).toEqual([
      ['match-decided', 'user-a'],
      ['match-decided', 'user-b'],
    ]);
    expect(drafts.every((item) => item.slot.key === 'evening:2026-10-24')).toBe(
      true,
    );
  });

  test('不戦勝で確定したマッチも勝敗結果を作る', () => {
    const drafts = matchNoticeDrafts({
      topic: 'match_result',
      matches: [
        match({
          matchDate: TODAY,
          phase: 'finished',
          decided: true,
          entries: [entry('a')],
        }),
      ],
      eligible: ELIGIBLE,
    });

    expect(drafts.map((item) => item.recipientUserId)).toEqual(['user-a']);
  });

  test('投稿者・プロダクトの紐付けが無い側と、受信する設定の送信の対象者でない投稿者を除く', () => {
    const drafts = matchNoticeDrafts({
      topic: 'match_result',
      matches: [
        match({
          matchDate: TODAY,
          phase: 'finished',
          decided: true,
          entries: [entry('a', { ownerUserId: null }), entry('b')],
        }),
        match({
          matchId: 'match-2',
          matchDate: TODAY,
          phase: 'finished',
          decided: true,
          entries: [entry('a'), entry('b', { productId: null })],
        }),
        match({
          matchId: 'match-3',
          matchDate: TODAY,
          phase: 'finished',
          decided: true,
          entries: [entry('c'), entry('b')],
        }),
      ],
      eligible: ELIGIBLE,
    });

    expect(drafts.map((item) => [item.matchId, item.entryId])).toEqual([
      ['match-1', 'entry-b'],
      ['match-2', 'entry-a'],
      ['match-3', 'entry-b'],
    ]);
  });

  test('紐付けの無い側があっても、側が2つなら相手の投稿者へ開始予告を作る', () => {
    const drafts = matchNoticeDrafts({
      topic: 'match_preview',
      matches: [
        match({ entries: [entry('a'), entry('b', { productId: null })] }),
      ],
      eligible: ELIGIBLE,
    });

    expect(drafts.map((item) => item.recipientUserId)).toEqual(['user-a']);
  });
});

describe('noticeDedupeKey', () => {
  test('マッチの通知は種別・マッチ・側・宛先から作る', () => {
    expect(noticeDedupeKey(draft())).toBe(
      'match_result:match-1:entry-a:user-a',
    );
  });

  test('側の無い開催通知はプロダクト、受賞は通知イベントのIDを使う', () => {
    expect(
      noticeDedupeKey(
        draft({
          topic: 'followed_user_match',
          recipientUserId: 'follower-1',
          slot: morningSlot(TODAY),
          entryId: null,
        }),
      ),
    ).toBe('followed_user_match:match-1:product-a:follower-1');
    expect(
      noticeDedupeKey(
        draft({
          topic: 'followed_user_award',
          recipientUserId: 'follower-1',
          slot: awardSlot(EVENT_ID, EXPANDED_AT),
          matchId: null,
          entryId: null,
          eventId: EVENT_ID,
        }),
      ),
    ).toBe(`followed_user_award:${EVENT_ID}:product-a:follower-1`);
  });

  test('同じマッチの同じ側の予告と結果は別のキーになる', () => {
    expect(noticeDedupeKey(draft({ topic: 'match_preview' }))).not.toBe(
      noticeDedupeKey(draft()),
    );
  });

  test('出どころのIDが無ければ例外を投げる', () => {
    expect(() =>
      noticeDedupeKey(draft({ matchId: null, eventId: null })),
    ).toThrow(RangeError);
    expect(() =>
      noticeDedupeKey(draft({ entryId: null, productId: null })),
    ).toThrow(RangeError);
  });
});

describe('groupKeyFor', () => {
  test('夜の枠は枠・宛先・プロダクトでまとめ、当日の結果と翌日の予告が同じキーになる', () => {
    const result = draft();
    const preview = draft({
      topic: 'match_preview',
      slot: previewSlotFor(TOMORROW),
      matchId: 'match-2',
      entryId: 'entry-next',
    });

    expect(groupKeyFor(result)).toBe('evening:2026-10-24:user-a:product-a');
    expect(groupKeyFor(preview)).toBe(groupKeyFor(result));
    expect(groupKeyFor(draft({ productId: 'product-z' }))).not.toBe(
      groupKeyFor(result),
    );
  });

  test('朝と受賞の枠は枠と宛先でまとめる', () => {
    expect(
      groupKeyFor(
        draft({
          topic: 'followed_user_match',
          recipientUserId: 'follower-1',
          slot: morningSlot(TODAY),
          entryId: null,
        }),
      ),
    ).toBe('morning:2026-10-24:follower-1');
    expect(
      groupKeyFor(
        draft({
          topic: 'followed_user_award',
          recipientUserId: 'follower-1',
          slot: awardSlot(EVENT_ID, EXPANDED_AT),
          matchId: null,
          entryId: null,
          eventId: EVENT_ID,
        }),
      ),
    ).toBe(`award:${EVENT_ID}:follower-1`);
  });

  test('夜の枠でプロダクトが無ければ例外を投げる', () => {
    expect(() => groupKeyFor(draft({ productId: null }))).toThrow(RangeError);
  });
});

describe('planGroupEmail', () => {
  const result = pending('notice-result');
  const preview = pending('notice-preview', {
    topic: 'match_preview',
    slot: previewSlotFor(TOMORROW),
    matchId: 'match-2',
    entryId: 'entry-next',
  });

  test('同じ夜の枠の結果と予告を、両方を受信する設定なら1通に統合する', () => {
    expect(
      planGroupEmail({ notices: [preview, result], enabledTopics: ALL_TOPICS }),
    ).toEqual({
      plan: {
        kind: 'match-result',
        recipientUserId: 'user-a',
        result,
        preview,
      },
      skipped: [],
    });
  });

  test('結果だけなら予告の無い勝敗結果のメールにする', () => {
    expect(
      planGroupEmail({ notices: [result], enabledTopics: ALL_TOPICS }),
    ).toEqual({
      plan: {
        kind: 'match-result',
        recipientUserId: 'user-a',
        result,
        preview: null,
      },
      skipped: [],
    });
  });

  test('予告を受信しない設定なら統合せず、予告を受信しない種別として送らない', () => {
    expect(
      planGroupEmail({
        notices: [result, preview],
        enabledTopics: new Set(['match_result']),
      }),
    ).toEqual({
      plan: {
        kind: 'match-result',
        recipientUserId: 'user-a',
        result,
        preview: null,
      },
      skipped: [{ noticeId: 'notice-preview', reason: 'topic_disabled' }],
    });
  });

  test('結果を受信しない設定なら予告だけのメールにする', () => {
    expect(
      planGroupEmail({
        notices: [result, preview],
        enabledTopics: new Set(['match_preview']),
      }),
    ).toEqual({
      plan: {
        kind: 'match-preview',
        recipientUserId: 'user-a',
        preview,
      },
      skipped: [{ noticeId: 'notice-result', reason: 'topic_disabled' }],
    });
  });

  test('どの種別も受信しない設定なら送らない', () => {
    expect(
      planGroupEmail({ notices: [result, preview], enabledTopics: new Set() }),
    ).toEqual({
      plan: null,
      skipped: [
        { noticeId: 'notice-result', reason: 'topic_disabled' },
        { noticeId: 'notice-preview', reason: 'topic_disabled' },
      ],
    });
  });

  test('送信の対象者でなければ全てを宛先が使えない理由で送らない', () => {
    expect(
      planGroupEmail({ notices: [result, preview], enabledTopics: undefined }),
    ).toEqual({
      plan: null,
      skipped: [
        { noticeId: 'notice-result', reason: 'recipient_unavailable' },
        { noticeId: 'notice-preview', reason: 'recipient_unavailable' },
      ],
    });
  });

  test('通知が無ければ計画も送らない通知も無い', () => {
    expect(planGroupEmail({ notices: [], enabledTopics: ALL_TOPICS })).toEqual({
      plan: null,
      skipped: [],
    });
  });

  test('同じまとめのキーに重なった2件目以降の結果と予告は古い通知として送らない', () => {
    const second = pending('notice-result-2', { matchId: 'match-9' });
    const secondPreview = pending('notice-preview-2', {
      topic: 'match_preview',
      slot: previewSlotFor(TOMORROW),
      matchId: 'match-8',
    });

    expect(
      planGroupEmail({
        notices: [result, preview, second, secondPreview],
        enabledTopics: ALL_TOPICS,
      }),
    ).toEqual({
      plan: {
        kind: 'match-result',
        recipientUserId: 'user-a',
        result,
        preview,
      },
      skipped: [
        { noticeId: 'notice-result-2', reason: 'stale' },
        { noticeId: 'notice-preview-2', reason: 'stale' },
      ],
    });
  });

  function followedMatch(index: number): PendingNotice {
    return pending(`notice-${String(index).padStart(2, '0')}`, {
      topic: 'followed_user_match',
      recipientUserId: 'follower-1',
      slot: morningSlot(TODAY),
      matchId: `match-${String(index)}`,
      entryId: null,
      productId: `product-${String(index)}`,
    });
  }

  test('開催通知は1件でも作成の順に1通へまとめる', () => {
    const notices = [followedMatch(1), followedMatch(2)];

    expect(planGroupEmail({ notices, enabledTopics: ALL_TOPICS })).toEqual({
      plan: {
        kind: 'followed-user-matches',
        recipientUserId: 'follower-1',
        items: notices,
        omittedCount: 0,
      },
      skipped: [],
    });
  });

  test('開催通知は30件までを載せ、31件目以降は残りの件数に数えて送った扱いにする', () => {
    const notices = Array.from({ length: 32 }, (_, index) =>
      followedMatch(index + 1),
    );

    const { plan, skipped } = planGroupEmail({
      notices,
      enabledTopics: new Set(['followed_user_match']),
    });

    expect(DIGEST_ITEM_LIMIT).toBe(30);
    expect(plan).toEqual({
      kind: 'followed-user-matches',
      recipientUserId: 'follower-1',
      items: notices.slice(0, 30),
      omittedCount: 2,
    });
    expect(skipped).toEqual([]);
  });

  test('ちょうど30件なら残りの件数は0になる', () => {
    const notices = Array.from({ length: 30 }, (_, index) =>
      followedMatch(index + 1),
    );

    expect(
      planGroupEmail({ notices, enabledTopics: ALL_TOPICS }).plan,
    ).toMatchObject({ omittedCount: 0 });
  });

  test('開催通知を受信しない設定なら送らない', () => {
    expect(
      planGroupEmail({
        notices: [followedMatch(1)],
        enabledTopics: new Set(['match_result']),
      }),
    ).toEqual({
      plan: null,
      skipped: [{ noticeId: 'notice-01', reason: 'topic_disabled' }],
    });
  });

  test('受賞結果は1件を1通にする', () => {
    const award = pending('notice-award', {
      topic: 'followed_user_award',
      recipientUserId: 'follower-1',
      slot: awardSlot(EVENT_ID, EXPANDED_AT),
      matchId: null,
      entryId: null,
      eventId: EVENT_ID,
    });

    expect(
      planGroupEmail({ notices: [award], enabledTopics: ALL_TOPICS }),
    ).toEqual({
      plan: {
        kind: 'followed-user-award',
        recipientUserId: 'follower-1',
        award,
      },
      skipped: [],
    });
  });
});
