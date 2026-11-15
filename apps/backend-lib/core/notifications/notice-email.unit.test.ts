import { describe, expect, test } from 'bun:test';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import {
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../email/kinds/notifications.ts';
import {
  buildNoticeEmail,
  type NoticeEmailBuild,
  unsubscribeTargetsOf,
  unsubscribeTokenKey,
} from './notice-email.ts';
import type { NoticeSkipReason } from './notice-plan.ts';
import {
  AWARD_PLAN,
  AWARD_TOKEN,
  CLIENT_ORIGIN,
  context,
  EARLIER_LIVE_MATCH,
  emailOf,
  entry,
  EVENT_ID,
  EVENT_ORIGIN,
  FOLLOWED_MATCH_TOKEN,
  followedNotice,
  LIVE_MATCH,
  matchesPlan,
  MY_PRODUCTS_URL,
  NEXT_MATCH,
  notice,
  OWNER,
  PAY_ACTION,
  PREVIEW_NOTICE,
  PREVIEW_TOKEN,
  previewPlan,
  RESULT_MATCH,
  RESULT_TOKEN,
  resultPlan,
  SETTINGS_URL,
  SUPPLEMENT,
  TOP_PAGE_URL,
  withMatch,
  withoutMaker,
  withoutProduct,
} from './notice-email.fixtures.ts';
import {
  listUnsubscribeHeaders,
  unsubscribePageUrl,
} from './unsubscribe-token.ts';

const UNAVAILABLE = '非公開のプロダクト';

const skipOf = (
  noticeId: string,
  reason: NoticeSkipReason,
): NoticeEmailBuild => ({
  kind: 'skip',
  skipped: [{ noticeId, reason }],
});

describe('buildNoticeEmail: マッチ開始予告', () => {
  test('相手・マッチの表記・開始と終了の日時・トップページと、予告の種別の配信停止のリンクとヘッダーで組み立てる', () => {
    const build = emailOf(buildNoticeEmail(previewPlan(), context()));

    expect(build.emailKind).toBe(NOTIFICATION_MATCH_PREVIEW_KIND);
    expect(build.input).toEqual({
      nickname: '山田',
      ownProductName: 'Pitch Notes',
      opponentProductName: 'Goal Line',
      matchLabel: 'Week 準決勝',
      startsAt: '2026-10-25T08:00:00.000Z',
      endsAt: '2026-10-26T07:40:00.000Z',
      topPageUrl: TOP_PAGE_URL,
      settingsUrl: SETTINGS_URL,
      unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, PREVIEW_TOKEN),
    });
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, PREVIEW_TOKEN),
    );
    expect(build.sentNoticeIds).toEqual(['notice-preview']);
    expect(build.skipped).toEqual([]);
  });

  test('単独の開始予告の送信の期限はマッチの開始の日時にする', () => {
    const build = emailOf(buildNoticeEmail(previewPlan(), context()));

    expect(build.deadline).toEqual(NEXT_MATCH.startsAt);
  });

  test('組み立てた入力が種別の入力の検証を通り、検証で値が変わらない', () => {
    const build = emailOf(buildNoticeEmail(previewPlan(), context()));

    expect(
      NOTIFICATION_MATCH_PREVIEW_KIND.inputSchema.parse(build.input) as unknown,
    ).toEqual(build.input);
  });

  test('相手のプロダクトが表示できなければ「非公開のプロダクト」と示す', () => {
    const build = emailOf(
      buildNoticeEmail(previewPlan(), withoutProduct('product-c')),
    );

    expect(build.input).toMatchObject({ opponentProductName: UNAVAILABLE });
  });

  test.each(['live', 'tallying', 'finished'] as const)(
    'マッチが%sに進んでいれば古い予告として送らない',
    (phase) => {
      expect(
        buildNoticeEmail(previewPlan(), withMatch({ ...NEXT_MATCH, phase })),
      ).toEqual(skipOf('notice-preview', 'stale'));
    },
  );

  test('開始の日時を過ぎていれば古い予告として送らない', () => {
    expect(
      buildNoticeEmail(previewPlan(), context({ now: NEXT_MATCH.startsAt })),
    ).toEqual(skipOf('notice-preview', 'stale'));
  });

  test('側が2つでなくなった・照会で見つからない・自分の側が無いマッチは古い予告として送らない', () => {
    const contexts = [
      withMatch({ ...NEXT_MATCH, entries: NEXT_MATCH.entries.slice(0, 1) }),
      context({ matches: new Map() }),
      withMatch({ ...NEXT_MATCH, entries: [entry('b'), entry('c')] }),
    ];

    for (const value of contexts) {
      expect(buildNoticeEmail(previewPlan(), value)).toEqual(
        skipOf('notice-preview', 'stale'),
      );
    }
  });

  test('自分のプロダクトが非公開化・論理削除されていれば送らない(仮7)', () => {
    expect(
      buildNoticeEmail(previewPlan(), withoutProduct('product-a')),
    ).toEqual(skipOf('notice-preview', 'own_product_unavailable'));
  });

  test('ラウンドの無いトーナメントのマッチは表記を作れないため古い予告として送らない', () => {
    expect(
      buildNoticeEmail(
        previewPlan(),
        withMatch({ ...NEXT_MATCH, stage: null }),
      ),
    ).toEqual(skipOf('notice-preview', 'stale'));
  });

  test('ローカルのhttp:のイベントサーバーのオリジンではヘッダーを付けない', () => {
    const build = emailOf(
      buildNoticeEmail(
        previewPlan(),
        context({
          origins: {
            client: 'http://localhost:3000',
            event: 'http://localhost:8788',
          },
        }),
      ),
    );

    expect(build.headers).toEqual({});
    expect(build.input).toMatchObject({
      settingsUrl: 'http://localhost:3000/settings/notifications',
      topPageUrl: 'http://localhost:3000/',
    });
  });
});

describe('buildNoticeEmail: 勝敗結果', () => {
  test('結果・スコア・行動と、結果の種別の配信停止のリンクとヘッダーで組み立て、期限を付けない', () => {
    const build = emailOf(buildNoticeEmail(resultPlan(), context()));

    expect(build.emailKind).toBe(NOTIFICATION_MATCH_RESULT_KIND);
    expect(build.input).toEqual({
      nickname: '山田',
      ownProductName: 'Pitch Notes',
      opponentProductName: 'Tactics Board',
      matchLabel: '予選',
      outcome: 'won',
      decidedByLastUpvote: false,
      ownVotes: 12,
      opponentVotes: 9,
      supplements: [],
      action: { label: '自分のプロダクトを見る', url: MY_PRODUCTS_URL },
      next: null,
      settingsUrl: SETTINGS_URL,
      unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, RESULT_TOKEN),
    });
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, RESULT_TOKEN),
    );
    expect(build.deadline).toBeUndefined();
    expect(build.sentNoticeIds).toEqual(['notice-result']);
    expect(
      NOTIFICATION_MATCH_RESULT_KIND.inputSchema.parse(build.input) as unknown,
    ).toEqual(build.input);
  });

  test('スコアは自分対相手の順で、敗北の側から見れば逆になる', () => {
    const lost = notice('notice-lost', {
      recipientUserId: 'user-b',
      entryId: 'entry-b',
      productId: 'product-b',
    });
    const build = emailOf(
      buildNoticeEmail(
        {
          kind: 'match-result',
          recipientUserId: 'user-b',
          result: lost,
          preview: null,
        },
        context({ tokens: new Map([['user-b:match_result', RESULT_TOKEN]]) }),
      ),
    );

    expect(build.input).toMatchObject({
      ownProductName: 'Tactics Board',
      opponentProductName: 'Pitch Notes',
      outcome: 'lost',
      ownVotes: 9,
      opponentVotes: 12,
    });
  });

  test('最終Upvote時間で決まった結果を示す', () => {
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(),
        withMatch({ ...RESULT_MATCH, decision: 'last_upvote' }),
      ),
    );

    expect(build.input).toMatchObject({ decidedByLastUpvote: true });
  });

  test('両者敗北と不戦勝を結果の写像どおりに示す', () => {
    const noVotes = emailOf(
      buildNoticeEmail(
        resultPlan(),
        withMatch({
          ...RESULT_MATCH,
          decision: 'no_votes',
          entries: [
            entry('a', { result: 'lost' }),
            entry('b', { result: 'lost' }),
          ],
        }),
      ),
    );
    const bye = emailOf(
      buildNoticeEmail(
        resultPlan(),
        withMatch({
          ...RESULT_MATCH,
          decision: 'bye',
          entries: [entry('a', { result: 'bye' })],
        }),
      ),
    );

    expect(noVotes.input).toMatchObject({
      outcome: 'no_votes',
      ownVotes: 0,
      opponentVotes: 0,
    });
    expect(bye.input).toMatchObject({
      outcome: 'bye',
      opponentProductName: UNAVAILABLE,
      ownVotes: 0,
      opponentVotes: 0,
    });
  });

  test('相手のプロダクトが表示できなければ「非公開のプロダクト」と示す', () => {
    const build = emailOf(
      buildNoticeEmail(resultPlan(), withoutProduct('product-b')),
    );

    expect(build.input).toMatchObject({ opponentProductName: UNAVAILABLE });
  });

  test('自分のプロダクトが非公開化・論理削除されていれば送らない(仮7)', () => {
    expect(buildNoticeEmail(resultPlan(), withoutProduct('product-a'))).toEqual(
      skipOf('notice-result', 'own_product_unavailable'),
    );
  });

  test('両者の不戦敗(結果の写像がnull)は送らない', () => {
    expect(
      buildNoticeEmail(
        resultPlan(),
        withMatch({
          ...RESULT_MATCH,
          decision: 'both_forfeited',
          entries: [
            entry('a', { result: 'lost' }),
            entry('b', { result: 'lost' }),
          ],
        }),
      ),
    ).toEqual(skipOf('notice-result', 'own_product_unavailable'));
  });

  test('確定していない・照会で見つからない・自分の側が無いマッチは古い通知として送らない', () => {
    const contexts = [
      withMatch({ ...RESULT_MATCH, decision: null }),
      withMatch({ ...RESULT_MATCH, entries: [entry('a'), entry('b')] }),
      withMatch({ ...RESULT_MATCH, entries: [entry('c'), entry('b')] }),
      context({ matches: new Map() }),
    ];

    for (const value of contexts) {
      expect(buildNoticeEmail(resultPlan(), value)).toEqual(
        skipOf('notice-result', 'stale'),
      );
    }
  });

  test('追記を3件まで載せ、行動のボタンを持つ最初の追記を主要な行動にする', () => {
    const supplements = [
      SUPPLEMENT,
      { ...SUPPLEMENT, title: '2件目', action: PAY_ACTION },
      {
        ...SUPPLEMENT,
        title: '3件目',
        action: { label: '別の行動', url: TOP_PAGE_URL },
      },
      { ...SUPPLEMENT, title: '4件目' },
    ];
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(),
        context({ supplements: new Map([['notice-result', supplements]]) }),
      ),
    );

    expect(build.input).toMatchObject({
      supplements: supplements.slice(0, 3),
      action: PAY_ACTION,
    });
    expect(
      NOTIFICATION_MATCH_RESULT_KIND.inputSchema.parse(build.input) as unknown,
    ).toEqual(build.input);
  });

  test('載せた3件に行動のボタンが無ければ「自分のプロダクトを見る」にする', () => {
    const supplements = [
      SUPPLEMENT,
      SUPPLEMENT,
      SUPPLEMENT,
      { ...SUPPLEMENT, action: PAY_ACTION },
    ];
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(),
        context({ supplements: new Map([['notice-result', supplements]]) }),
      ),
    );

    expect(build.input).toMatchObject({
      action: { label: '自分のプロダクトを見る', url: MY_PRODUCTS_URL },
    });
  });
});

describe('buildNoticeEmail: 勝敗結果と翌日予告の統合', () => {
  test('翌日のマッチを添え、ヘッダーは勝敗結果のトークンで、本文に2つの配信停止のリンクを入れる(仮4)', () => {
    const build = emailOf(
      buildNoticeEmail(resultPlan(PREVIEW_NOTICE), context()),
    );

    expect(build.emailKind).toBe(NOTIFICATION_MATCH_RESULT_KIND);
    expect(build.input).toMatchObject({
      outcome: 'won',
      unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, RESULT_TOKEN),
      next: {
        opponentProductName: 'Goal Line',
        roundName: '準決勝',
        matchLabel: 'Week 準決勝',
        startsAt: '2026-10-25T08:00:00.000Z',
        endsAt: '2026-10-26T07:40:00.000Z',
        unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, PREVIEW_TOKEN),
      },
    });
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, RESULT_TOKEN),
    );
    expect(build.sentNoticeIds).toEqual(['notice-result', 'notice-preview']);
    expect(build.skipped).toEqual([]);
    expect(
      NOTIFICATION_MATCH_RESULT_KIND.inputSchema.parse(build.input) as unknown,
    ).toEqual(build.input);
  });

  test('統合したメールには送信の期限を付けない', () => {
    const build = emailOf(
      buildNoticeEmail(resultPlan(PREVIEW_NOTICE), context()),
    );

    expect(build.deadline).toBeUndefined();
  });

  test('翌日の相手のプロダクトが表示できなければ「非公開のプロダクト」と示す', () => {
    const build = emailOf(
      buildNoticeEmail(resultPlan(PREVIEW_NOTICE), withoutProduct('product-c')),
    );

    expect(build.input).toMatchObject({
      next: { opponentProductName: UNAVAILABLE },
    });
  });

  test('不戦勝の結果も翌日の予告と統合する', () => {
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(PREVIEW_NOTICE),
        withMatch({
          ...RESULT_MATCH,
          decision: 'walkover',
          entries: [
            entry('a', { result: 'walkover' }),
            entry('b', { result: 'lost' }),
          ],
        }),
      ),
    );

    expect(build.input).toMatchObject({
      outcome: 'bye',
      next: { roundName: '準決勝' },
    });
  });

  test('翌日のマッチが古くなっていれば予告だけを外して結果だけのメールにする', () => {
    const contexts = [
      withMatch({ ...NEXT_MATCH, phase: 'live' }),
      withMatch({ ...NEXT_MATCH, entries: NEXT_MATCH.entries.slice(0, 1) }),
    ];

    for (const value of contexts) {
      const build = emailOf(
        buildNoticeEmail(resultPlan(PREVIEW_NOTICE), value),
      );

      expect(build.input).toMatchObject({ next: null });
      expect(build.sentNoticeIds).toEqual(['notice-result']);
      expect(build.skipped).toEqual([
        { noticeId: 'notice-preview', reason: 'stale' },
      ]);
      expect(build.headers).toEqual(
        listUnsubscribeHeaders(EVENT_ORIGIN, RESULT_TOKEN),
      );
      expect(build.deadline).toBeUndefined();
    }
  });

  test('勝利と不戦勝以外の結果は統合できないため、予告を外して結果だけのメールにする', () => {
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(PREVIEW_NOTICE),
        withMatch({
          ...RESULT_MATCH,
          entries: [
            entry('a', { upvoteCount: 9, result: 'lost' }),
            entry('b', { upvoteCount: 12, result: 'won' }),
          ],
        }),
      ),
    );

    expect(build.input).toMatchObject({ outcome: 'lost', next: null });
    expect(build.skipped).toEqual([
      { noticeId: 'notice-preview', reason: 'stale' },
    ]);
  });

  test('翌日のマッチが予選ならラウンド名が無いため、予告を外して結果だけのメールにする', () => {
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(PREVIEW_NOTICE),
        withMatch({ ...NEXT_MATCH, kind: 'qualifier', stage: null }),
      ),
    );

    expect(build.input).toMatchObject({ next: null });
    expect(build.skipped).toEqual([
      { noticeId: 'notice-preview', reason: 'stale' },
    ]);
  });

  test('結果を送れないときは予告を単独の開始予告として送る', () => {
    const build = emailOf(
      buildNoticeEmail(
        resultPlan(PREVIEW_NOTICE),
        withMatch({ ...RESULT_MATCH, decision: null }),
      ),
    );

    expect(build.emailKind).toBe(NOTIFICATION_MATCH_PREVIEW_KIND);
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, PREVIEW_TOKEN),
    );
    expect(build.deadline).toEqual(NEXT_MATCH.startsAt);
    expect(build.sentNoticeIds).toEqual(['notice-preview']);
    expect(build.skipped).toEqual([
      { noticeId: 'notice-result', reason: 'stale' },
    ]);
  });

  test('自分のプロダクトが非公開化されていれば結果と予告のどちらも送らない(仮7)', () => {
    expect(
      buildNoticeEmail(resultPlan(PREVIEW_NOTICE), withoutProduct('product-a')),
    ).toEqual({
      kind: 'skip',
      skipped: [
        { noticeId: 'notice-result', reason: 'own_product_unavailable' },
        { noticeId: 'notice-preview', reason: 'own_product_unavailable' },
      ],
    });
  });
});

describe('buildNoticeEmail: フォロー中ユーザーのマッチ開催', () => {
  const items = [
    followedNotice('notice-1', 'match-live', 'b'),
    followedNotice('notice-2', 'match-live-week', 'e'),
  ];

  test('項目ごとのプロダクト・投稿者・マッチの表記・相手と、残りの件数と開催の種別の配信停止で組み立てる', () => {
    const build = emailOf(buildNoticeEmail(matchesPlan(items, 5), context()));

    expect(build.emailKind).toBe(NOTIFICATION_FOLLOWED_USER_MATCHES_KIND);
    expect(build.input).toEqual({
      nickname: '山田',
      items: [
        {
          productName: 'Tactics Board',
          makerNickname: '佐藤',
          matchLabel: '予選',
          opponentProductName: 'Corner Kick',
        },
        {
          productName: 'Free Kick',
          makerNickname: '田中',
          matchLabel: 'Week 2回戦',
          opponentProductName: 'Goal Line',
        },
      ],
      omittedCount: 5,
      topPageUrl: TOP_PAGE_URL,
      settingsUrl: SETTINGS_URL,
      unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, FOLLOWED_MATCH_TOKEN),
    });
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, FOLLOWED_MATCH_TOKEN),
    );
    expect(build.sentNoticeIds).toEqual(['notice-1', 'notice-2']);
    expect(
      NOTIFICATION_FOLLOWED_USER_MATCHES_KIND.inputSchema.parse(
        build.input,
      ) as unknown,
    ).toEqual(build.input);
  });

  test('送信の期限は載せた項目のマッチの終了の日時のうち最も早い時刻にする', () => {
    const build = emailOf(buildNoticeEmail(matchesPlan(items), context()));

    expect(build.deadline).toEqual(EARLIER_LIVE_MATCH.endsAt);
  });

  test('プロダクトか投稿者が表示できない項目を除き、期限も残った項目から求める', () => {
    for (const value of [withoutProduct('product-e'), withoutMaker('user-e')]) {
      const build = emailOf(buildNoticeEmail(matchesPlan(items), value));

      expect(build.input).toMatchObject({
        items: [{ productName: 'Tactics Board' }],
      });
      expect(build.sentNoticeIds).toEqual(['notice-1']);
      expect(build.skipped).toEqual([
        { noticeId: 'notice-2', reason: 'own_product_unavailable' },
      ]);
      expect(build.deadline).toEqual(LIVE_MATCH.endsAt);
    }
  });

  test('相手のプロダクトが表示できなければ「非公開のプロダクト」と示す', () => {
    const build = emailOf(
      buildNoticeEmail(matchesPlan(items), withoutProduct('product-d')),
    );

    expect(build.input).toMatchObject({
      items: [
        { opponentProductName: UNAVAILABLE },
        { productName: 'Free Kick' },
      ],
    });
  });

  test('マッチ中でなくなった・照会で見つからない・相手の側が無い・対象の側が無いマッチの項目は古い通知として除く', () => {
    const contexts = [
      withMatch({ ...LIVE_MATCH, phase: 'finished' }),
      context({
        matches: new Map([[EARLIER_LIVE_MATCH.matchId, EARLIER_LIVE_MATCH]]),
      }),
      withMatch({ ...LIVE_MATCH, entries: [entry('b')] }),
      withMatch({ ...LIVE_MATCH, entries: [entry('c'), entry('d')] }),
    ];

    for (const value of contexts) {
      const build = emailOf(buildNoticeEmail(matchesPlan(items), value));

      expect(build.sentNoticeIds).toEqual(['notice-2']);
      expect(build.skipped).toEqual([
        { noticeId: 'notice-1', reason: 'stale' },
      ]);
    }
  });

  test('表示できる項目が0件になれば送らない', () => {
    expect(
      buildNoticeEmail(
        matchesPlan(items),
        withoutProduct('product-b', 'product-e'),
      ),
    ).toEqual({
      kind: 'skip',
      skipped: [
        { noticeId: 'notice-1', reason: 'own_product_unavailable' },
        { noticeId: 'notice-2', reason: 'own_product_unavailable' },
      ],
    });
  });
});

describe('buildNoticeEmail: フォロー中ユーザーの受賞結果', () => {
  test('投稿者・賞・期間の表記・プロダクト詳細のURLと受賞の種別の配信停止で組み立て、期限を付けない', () => {
    const build = emailOf(buildNoticeEmail(AWARD_PLAN, context()));

    expect(build.emailKind).toBe(NOTIFICATION_FOLLOWED_USER_AWARD_KIND);
    expect(build.input).toEqual({
      nickname: '山田',
      productName: 'Tactics Board',
      makerNickname: '佐藤',
      award: 'product_of_the_week',
      periodLabel: '2026年第37週(9/7〜9/13)',
      productUrl: 'https://launch.example/p/tactics-board',
      settingsUrl: SETTINGS_URL,
      unsubscribeUrl: unsubscribePageUrl(CLIENT_ORIGIN, AWARD_TOKEN),
    });
    expect(build.headers).toEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, AWARD_TOKEN),
    );
    expect(build.deadline).toBeUndefined();
    expect(build.sentNoticeIds).toEqual(['notice-award']);
    expect(
      NOTIFICATION_FOLLOWED_USER_AWARD_KIND.inputSchema.parse(
        build.input,
      ) as unknown,
    ).toEqual(build.input);
  });

  test('Product of the Yearの期間を年で示す', () => {
    const build = emailOf(
      buildNoticeEmail(
        AWARD_PLAN,
        context({
          awards: new Map([
            [EVENT_ID, { award: 'product_of_the_year', period: '2026' }],
          ]),
        }),
      ),
    );

    expect(build.input).toMatchObject({
      award: 'product_of_the_year',
      periodLabel: '2026年',
    });
  });

  test('プロダクトか投稿者が表示できなければ送らない', () => {
    for (const value of [withoutProduct('product-b'), withoutMaker('user-b')]) {
      expect(buildNoticeEmail(AWARD_PLAN, value)).toEqual(
        skipOf('notice-award', 'own_product_unavailable'),
      );
    }
  });

  test('通知イベントの照会の結果が無ければ古い通知として送らない', () => {
    expect(
      buildNoticeEmail(AWARD_PLAN, context({ awards: new Map() })),
    ).toEqual(skipOf('notice-award', 'stale'));
  });
});

describe('buildNoticeEmail: 配信停止のトークン', () => {
  test('主たる種別のトークンが無ければ呼び出し側の不具合として例外を投げる', () => {
    expect(() =>
      buildNoticeEmail(resultPlan(), context({ tokens: new Map() })),
    ).toThrow(RangeError);
  });

  test('統合したメールで予告のトークンが無ければ例外を投げる', () => {
    expect(() =>
      buildNoticeEmail(
        resultPlan(PREVIEW_NOTICE),
        context({
          tokens: new Map([[`${OWNER}:match_result`, RESULT_TOKEN]]),
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe('unsubscribeTargetsOf・unsubscribeTokenKey', () => {
  test('トークンの照会のキーは利用者のIDと通知種別をコロンでつなぐ', () => {
    expect(unsubscribeTokenKey({ userId: OWNER, topic: 'match_result' })).toBe(
      'user-a:match_result',
    );
  });

  test.each([
    [previewPlan(), ['match_preview']],
    [resultPlan(), ['match_result']],
    [resultPlan(PREVIEW_NOTICE), ['match_result', 'match_preview']],
    [
      matchesPlan([followedNotice('notice-1', 'match-live', 'b')]),
      ['followed_user_match'],
    ],
    [AWARD_PLAN, ['followed_user_award']],
  ] as const)('計画%#に要るトークンの対象を返す', (plan, topics) => {
    expect(unsubscribeTargetsOf(plan)).toEqual(
      topics.map((topic: NotificationTopic) => ({
        userId: plan.recipientUserId,
        topic,
      })),
    );
  });
});
