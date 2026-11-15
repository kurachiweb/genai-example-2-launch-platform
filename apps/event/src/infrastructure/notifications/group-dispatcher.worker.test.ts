import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../../../lib/core/email/kinds/notifications.ts';
import { EmailSendError } from '../../../lib/core/email/ports.ts';
import { awardPeriodLabel } from '../../../lib/core/notifications/notice-copy.ts';
import {
  awardSlot,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type { ResultNoticeSupplement } from '../../../lib/core/notifications/result-notice-supplements.ts';
import { listUnsubscribeHeaders } from '../../../lib/core/notifications/unsubscribe-token.ts';
import { createSuppressionRepository } from '../../../lib/workers/email/suppression-repository.ts';
import {
  DECIDED_AT,
  DURING_MATCH,
  ENDS_AT,
  STARTS_AT,
} from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertEventRow,
  MATCH_DAY,
} from '../../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  db,
  readNoticeRows,
  T0,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { productIdOf } from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  captureLogs,
  CLIENT_ORIGIN,
  createDispatcherHarness,
  createRecordingSender,
  createRecordingSupplementSource,
  type DispatcherHarness,
  emailOf,
  emailRequestIdOf,
  EVENING,
  EVENING_NOW,
  eveningDrafts,
  EVENT_ORIGIN,
  NEXT_DAY_WINDOW,
  noticeDraft,
  recipientIdOf,
  recipientMatch,
  resetDispatchTables,
  seedEveningMatches,
  seedRecipient,
  setSenderInfo,
} from './testing/group-dispatcher-fixtures.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const LIMIT = 20;

const SUPPLEMENT: ResultNoticeSupplement = {
  title: 'Weekトーナメントの参加費',
  lines: ['支払いの期限は11月21日07:40(UTC)です。'],
  action: {
    label: '参加費を支払う',
    url: 'https://client.test.example/my/entries',
  },
  emphasized: true,
};

const MORNING = morningSlot(MATCH_DAY);
const EARLY_END = new Date(ENDS_AT.getTime() - 3_600_000);
const AWARD_EVENT_ID = '01M7BNN5000000000000000002';
const AWARD_PERIOD = '2026-W47';

function tokenInUrl(url: string): string {
  const token = new URL(url).hash.replace('#token=', '');
  expect(token).not.toBe('');
  return token;
}

async function noticeStates() {
  return (await readNoticeRows()).map((row) => [
    row.recipientUserId,
    row.topic,
    row.status,
    row.skipReason,
    row.emailRequestId,
  ]);
}

async function recordEvening(harness: DispatcherHarness): Promise<void> {
  await harness.dependencies.notices.record(eveningDrafts(), T0);
}

// 受信者4が利用者5・6のマッチ中のプロダクトをフォローし、両方の開催通知と5の受賞結果を受信する
async function seedFollowedMatches(harness: DispatcherHarness): Promise<void> {
  await seedRecipient(4, ['followed_user_match', 'followed_user_award']);
  for (const owner of [5, 6, 7, 8]) {
    await seedRecipient(owner, []);
  }
  await insertMatches([
    recipientMatch(3, [{ owner: 5 }, { owner: 7 }], { startedAt: STARTS_AT }),
    recipientMatch(4, [{ owner: 6 }, { owner: 8 }], {
      kind: 'week',
      round: 2,
      startedAt: STARTS_AT,
      endsAt: EARLY_END,
    }),
  ]);
  await harness.dependencies.notices.record(
    [
      noticeDraft('followed_user_match', 4, MORNING, { match: 3, product: 5 }),
      noticeDraft('followed_user_match', 4, MORNING, { match: 4, product: 6 }),
    ],
    T0,
  );
}

const DIGEST_FOLLOWED_COUNT = 31;
const FIRST_FOLLOWED_OWNER = 10;
const OPPONENT_OFFSET = 100;

// 受信者4が利用者10〜40の31件のマッチ中のプロダクトをフォローし、開催通知の上限(30件)を1件超える
async function seedDigestOverflow(harness: DispatcherHarness): Promise<void> {
  await seedRecipient(4, ['followed_user_match']);
  const owners = Array.from(
    { length: DIGEST_FOLLOWED_COUNT },
    (_, offset) => FIRST_FOLLOWED_OWNER + offset,
  );
  for (const owner of owners) {
    await seedRecipient(owner, []);
    await seedRecipient(owner + OPPONENT_OFFSET, []);
  }
  await insertMatches(
    owners.map((owner) =>
      recipientMatch(owner, [{ owner }, { owner: owner + OPPONENT_OFFSET }], {
        startedAt: STARTS_AT,
      }),
    ),
  );
  await harness.dependencies.notices.record(
    owners.map((owner) =>
      noticeDraft('followed_user_match', 4, MORNING, {
        match: owner,
        product: owner,
      }),
    ),
    T0,
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDispatchTables();
  await setSenderInfo();
});

describe('EmailGroupDispatcher.dispatchNext(送信)', () => {
  test('統合したメール・勝敗結果・開始予告を正しい種別・入力・ヘッダー・期限で送り、送った通知を送信要求の識別子とともに確定する', async () => {
    const supplements = createRecordingSupplementSource(
      new Map([[matchIdOf(1), [SUPPLEMENT]]]),
    );
    const harness = createDispatcherHarness({ supplements });
    await seedEveningMatches();
    await recordEvening(harness);

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 3, skipped: 0, more: false });
    const [combined, result, preview] = harness.sender.sent;
    expect(harness.sender.sent).toHaveLength(3);
    expect(combined?.kind).toBe(NOTIFICATION_MATCH_RESULT_KIND);
    expect(combined?.to).toBe(emailOf(1));
    expect(combined?.input).toMatchObject({
      nickname: '利用者1',
      ownProductName: 'プロダクト1',
      opponentProductName: 'プロダクト2',
      matchLabel: '予選',
      outcome: 'won',
      decidedByLastUpvote: false,
      ownVotes: 12,
      opponentVotes: 9,
      supplements: [SUPPLEMENT],
      action: SUPPLEMENT.action,
      settingsUrl: `${CLIENT_ORIGIN}/settings/notifications`,
      next: {
        opponentProductName: 'プロダクト3',
        roundName: '1回戦',
        matchLabel: 'Week 1回戦',
        startsAt: NEXT_DAY_WINDOW.startsAt.toISOString(),
        endsAt: NEXT_DAY_WINDOW.endsAt.toISOString(),
      },
    });
    expect(combined).not.toHaveProperty('deadline');
    expect(result?.kind).toBe(NOTIFICATION_MATCH_RESULT_KIND);
    expect(result?.to).toBe(emailOf(2));
    expect(result?.input).toMatchObject({
      outcome: 'lost',
      supplements: [SUPPLEMENT],
      next: null,
    });
    expect(preview?.kind).toBe(NOTIFICATION_MATCH_PREVIEW_KIND);
    expect(preview?.to).toBe(emailOf(3));
    expect(preview?.deadline).toStrictEqual(NEXT_DAY_WINDOW.startsAt);
    expect(preview?.input).toMatchObject({
      ownProductName: 'プロダクト3',
      opponentProductName: 'プロダクト1',
      matchLabel: 'Week 1回戦',
    });
    expect(await noticeStates()).toEqual([
      [recipientIdOf(1), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(1), 'match_preview', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(2), 'match_result', 'sent', null, emailRequestIdOf(2)],
      [recipientIdOf(3), 'match_preview', 'sent', null, emailRequestIdOf(3)],
    ]);
  });

  test('配信停止のリンクとヘッダーは、宛先と種別ごとに照合できるトークンを使う', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);

    await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT);

    const [combined] = harness.sender.sent;
    const input = combined?.input as {
      readonly unsubscribeUrl: string;
      readonly next: { readonly unsubscribeUrl: string };
    };
    const resultToken = tokenInUrl(input.unsubscribeUrl);
    const previewToken = tokenInUrl(input.next.unsubscribeUrl);
    expect(combined?.headers).toStrictEqual(
      listUnsubscribeHeaders(EVENT_ORIGIN, resultToken),
    );
    await expect(
      harness.dependencies.tokens.resolve(resultToken),
    ).resolves.toStrictEqual({
      userId: recipientIdOf(1),
      topic: 'match_result',
    });
    await expect(
      harness.dependencies.tokens.resolve(previewToken),
    ).resolves.toStrictEqual({
      userId: recipientIdOf(1),
      topic: 'match_preview',
    });
  });

  test('勝敗結果の通知ごとの追記の入力を、照会したマッチの結果から1回でまとめて求める', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);

    await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT);

    const [first, second] = (await readNoticeRows()).filter(
      ({ topic }) => topic === 'match_result',
    );
    const common = {
      matchId: matchIdOf(1),
      kind: 'qualifier',
      round: null,
      stage: null,
      matchDate: MATCH_DAY,
      launchId: null,
      decidedAt: DECIDED_AT,
    } as const;
    expect(harness.supplements.requests).toStrictEqual([
      [
        {
          noticeId: first?.id,
          input: {
            ...common,
            entryId: entryIdOf(11),
            productId: productIdOf(1),
            ownerUserId: recipientIdOf(1),
            result: 'won',
          },
        },
        {
          noticeId: second?.id,
          input: {
            ...common,
            entryId: entryIdOf(12),
            productId: productIdOf(2),
            ownerUserId: recipientIdOf(2),
            result: 'lost',
          },
        },
      ],
    ]);
  });

  test('フォロー中の利用者のマッチを1通の開催通知にまとめ、載せたマッチの最も早い終了の日時を期限にする', async () => {
    const harness = createDispatcherHarness();
    await seedFollowedMatches(harness);

    const step = await harness.dispatcher.dispatchNext(
      MORNING.key,
      DURING_MATCH,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 1, skipped: 0, more: false });
    const [digest] = harness.sender.sent;
    expect(digest?.kind).toBe(NOTIFICATION_FOLLOWED_USER_MATCHES_KIND);
    expect(digest?.to).toBe(emailOf(4));
    expect(digest?.deadline).toStrictEqual(EARLY_END);
    expect(digest?.input).toMatchObject({
      nickname: '利用者4',
      items: [
        {
          productName: 'プロダクト5',
          makerNickname: '利用者5',
          matchLabel: '予選',
          opponentProductName: 'プロダクト7',
        },
        {
          productName: 'プロダクト6',
          makerNickname: '利用者6',
          matchLabel: 'Week 2回戦',
          opponentProductName: 'プロダクト8',
        },
      ],
      omittedCount: 0,
    });
    expect(await noticeStates()).toEqual([
      [
        recipientIdOf(4),
        'followed_user_match',
        'sent',
        null,
        emailRequestIdOf(1),
      ],
      [
        recipientIdOf(4),
        'followed_user_match',
        'sent',
        null,
        emailRequestIdOf(1),
      ],
    ]);
  });

  test('受賞結果は通知イベントの賞と期間を読み、期間を表記して期限なしで送る', async () => {
    const harness = createDispatcherHarness();
    await seedRecipient(4, ['followed_user_award']);
    await seedRecipient(5, []);
    await insertEventRow({
      id: AWARD_EVENT_ID,
      type: 'award',
      dedupeKey: `award:product_of_the_week:${AWARD_PERIOD}:${productIdOf(5)}`,
      publisher: 'tournament-week',
      award: 'product_of_the_week',
      period: AWARD_PERIOD,
      productId: productIdOf(5),
      status: 'expanded',
      occurredAt: T0,
      lastDispatchedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    const slot = awardSlot(AWARD_EVENT_ID, T0);
    await harness.dependencies.notices.record(
      [
        noticeDraft('followed_user_award', 4, slot, {
          product: 5,
          eventId: AWARD_EVENT_ID,
        }),
      ],
      T0,
    );

    const step = await harness.dispatcher.dispatchNext(
      slot.key,
      DURING_MATCH,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 1, skipped: 0, more: false });
    const [award] = harness.sender.sent;
    expect(award?.kind).toBe(NOTIFICATION_FOLLOWED_USER_AWARD_KIND);
    expect(award).not.toHaveProperty('deadline');
    expect(award?.input).toMatchObject({
      productName: 'プロダクト5',
      makerNickname: '利用者5',
      award: 'product_of_the_week',
      periodLabel: awardPeriodLabel('product_of_the_week', AWARD_PERIOD),
      productUrl: `${CLIENT_ORIGIN}/p/product5`,
    });
  });

  test('開催通知の31件目以降は件数だけを載せ、31件の通知を全て同じ送信要求の識別子で送った扱いに確定する', async () => {
    const harness = createDispatcherHarness();
    await seedDigestOverflow(harness);

    const step = await harness.dispatcher.dispatchNext(
      MORNING.key,
      DURING_MATCH,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 1, skipped: 0, more: false });
    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.sender.sent[0]?.input).toMatchObject({ omittedCount: 1 });
    const rows = await readNoticeRows();
    expect(rows).toHaveLength(DIGEST_FOLLOWED_COUNT);
    expect(
      rows.every(
        ({ status, skipReason, emailRequestId }) =>
          status === 'sent' &&
          skipReason === null &&
          emailRequestId === emailRequestIdOf(1),
      ),
    ).toBe(true);
  });

  test('まとめのキー全体の理由は、開催通知の31件目以降を含む全ての通知を送らない扱いに確定する', async () => {
    const harness = createDispatcherHarness();
    await seedDigestOverflow(harness);
    await createSuppressionRepository(db, { now: () => T0 }).record(
      emailOf(4),
      { lastReason: 'complaint', lastEventAt: T0, expiresAt: null },
    );

    const step = await harness.dispatcher.dispatchNext(
      MORNING.key,
      DURING_MATCH,
      LIMIT,
    );

    expect(step).toStrictEqual({
      emails: 0,
      skipped: DIGEST_FOLLOWED_COUNT,
      more: false,
    });
    expect(harness.sender.sent).toEqual([]);
    const rows = await readNoticeRows();
    expect(rows).toHaveLength(DIGEST_FOLLOWED_COUNT);
    expect(
      rows.every(
        ({ status, skipReason }) =>
          status === 'skipped' && skipReason === 'suppressed',
      ),
    ).toBe(true);
  });

  test('上限の数のまとめだけを処理し、上限まで処理した段は続きがあると返す', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    const nextPendingGroups = vi.spyOn(
      harness.dependencies.notices,
      'nextPendingGroups',
    );

    const first = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      2,
    );
    const second = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      2,
    );
    const third = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      2,
    );

    expect([first, second, third]).toStrictEqual([
      { emails: 2, skipped: 0, more: true },
      { emails: 1, skipped: 0, more: false },
      { emails: 0, skipped: 0, more: false },
    ]);
    expect(harness.sender.sent.map(({ to }) => to)).toEqual([
      emailOf(1),
      emailOf(2),
      emailOf(3),
    ]);
    expect(nextPendingGroups.mock.calls).toEqual([
      [EVENING.key, 2],
      [EVENING.key, 2],
      [EVENING.key, 2],
    ]);
  });

  test('マッチの照会は処理の時点の時刻を渡して1回だけ行う', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    const findMatches = vi.spyOn(harness.dependencies.matches, 'findMatches');

    await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT);

    expect(findMatches).toHaveBeenCalledTimes(1);
    expect(findMatches.mock.calls[0]?.[1]).toBe(EVENING_NOW);
    expect(new Set(findMatches.mock.calls[0]?.[0])).toStrictEqual(
      new Set([matchIdOf(1), matchIdOf(2)]),
    );
  });
});

describe('EmailGroupDispatcher.dispatchNext(送信の失敗)', () => {
  test('送信の依頼の後の確定が失敗した再試行では、同じ通知をもう1通依頼して確定する(許容する重複)', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await harness.dependencies.notices.record(
      [
        noticeDraft('match_preview', 3, EVENING, {
          match: 2,
          entry: 22,
          product: 3,
        }),
      ],
      T0,
    );
    vi.spyOn(harness.dependencies.notices, 'settle').mockRejectedValueOnce(
      new Error('D1の書き込みに失敗しました'),
    );

    await expect(
      harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT),
    ).rejects.toThrow('D1の書き込みに失敗しました');
    expect(await noticeStates()).toEqual([
      [recipientIdOf(3), 'match_preview', 'pending', null, null],
    ]);

    const retried = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(retried).toStrictEqual({ emails: 1, skipped: 0, more: false });
    expect(harness.sender.sent.map(({ kind, to }) => [kind, to])).toEqual([
      [NOTIFICATION_MATCH_PREVIEW_KIND, emailOf(3)],
      [NOTIFICATION_MATCH_PREVIEW_KIND, emailOf(3)],
    ]);
    expect(await noticeStates()).toEqual([
      [recipientIdOf(3), 'match_preview', 'sent', null, emailRequestIdOf(2)],
    ]);
  });

  test('送り終えたメールの通知はメールごとに確定し、途中の送信の失敗の再試行では残りのまとめだけを送る', async () => {
    let calls = 0;
    const sender = createRecordingSender(() => {
      calls += 1;
      return calls === 2
        ? new Error('メッセージの送信に失敗しました')
        : undefined;
    });
    const harness = createDispatcherHarness({ sender });
    await seedEveningMatches();
    await recordEvening(harness);

    await expect(
      harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT),
    ).rejects.toThrow('メッセージの送信に失敗しました');
    expect(await noticeStates()).toEqual([
      [recipientIdOf(1), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(1), 'match_preview', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(2), 'match_result', 'pending', null, null],
      [recipientIdOf(3), 'match_preview', 'pending', null, null],
    ]);

    const retried = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(retried).toStrictEqual({ emails: 2, skipped: 0, more: false });
    expect(harness.sender.sent.map(({ to }) => to)).toEqual([
      emailOf(1),
      emailOf(2),
      emailOf(3),
    ]);
    expect(await noticeStates()).toEqual([
      [recipientIdOf(1), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(1), 'match_preview', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(2), 'match_result', 'sent', null, emailRequestIdOf(2)],
      [recipientIdOf(3), 'match_preview', 'sent', null, emailRequestIdOf(3)],
    ]);
  });

  test('送信の要求が拒否されたメールは理由とメール種別を報告し、そのメールの通知を送らない扱いにして他のメールは送る', async () => {
    const sender = createRecordingSender((request) =>
      request.kind === NOTIFICATION_MATCH_PREVIEW_KIND
        ? new EmailSendError('invalid-input')
        : undefined,
    );
    const harness = createDispatcherHarness({ sender });
    await seedEveningMatches();
    await recordEvening(harness);

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 2, skipped: 1, more: false });
    expect(harness.incidents).toStrictEqual([
      {
        kind: 'send-rejected',
        emailKind: NOTIFICATION_MATCH_PREVIEW_KIND.name,
        reason: 'invalid-input',
      },
    ]);
    expect((await noticeStates()).at(-1)).toEqual([
      recipientIdOf(3),
      'match_preview',
      'skipped',
      'send_rejected',
      null,
    ]);
  });

  test('送信の要求の拒否でない失敗はそのまま投げ、通知を未送信のまま残す', async () => {
    const sender = createRecordingSender(
      () => new Error('メッセージの送信に失敗しました'),
    );
    const harness = createDispatcherHarness({ sender });
    await seedEveningMatches();
    await recordEvening(harness);

    await expect(
      harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT),
    ).rejects.toThrow('メッセージの送信に失敗しました');

    expect(harness.incidents).toStrictEqual([]);
    expect(
      (await readNoticeRows()).every(({ status }) => status === 'pending'),
    ).toBe(true);
  });

  test('ログと報告にメールアドレス・ニックネーム・プロダクト名・トークンを含めない', async () => {
    const logs = captureLogs();
    try {
      const sender = createRecordingSender((request) =>
        request.kind === NOTIFICATION_MATCH_PREVIEW_KIND
          ? new EmailSendError('invalid-input')
          : undefined,
      );
      const harness = createDispatcherHarness({ sender });
      await seedEveningMatches();
      await recordEvening(harness);

      await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT);
      const tokens = await harness.dependencies.tokens.tokensFor(
        [1, 2, 3].flatMap((index) =>
          (['match_result', 'match_preview'] as const).map((topic) => ({
            userId: recipientIdOf(index),
            topic,
          })),
        ),
        T0,
      );
      await resetDispatchTables();
      await seedEveningMatches();
      await recordEvening(harness);
      await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT);

      const written = JSON.stringify([
        harness.incidents,
        logs.records.map(({ message, properties }) => [message, properties]),
      ]);
      expect(logs.records.length).toBeGreaterThan(0);
      for (const secret of [
        ...[1, 2, 3].flatMap((index) => [
          emailOf(index),
          `利用者${String(index)}`,
          `プロダクト${String(index)}`,
        ]),
        ...tokens.values(),
      ]) {
        expect(written).not.toContain(secret);
      }
    } finally {
      logs.stop();
    }
  });
});
