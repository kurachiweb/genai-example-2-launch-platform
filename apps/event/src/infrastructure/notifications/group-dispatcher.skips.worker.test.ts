import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { NOTIFICATION_MATCH_PREVIEW_KIND } from '../../../lib/core/email/kinds/notifications.ts';
import { UNAVAILABLE_PRODUCT_NAME } from '../../../lib/core/notifications/notice-copy.ts';
import { createSuppressionRepository } from '../../../lib/workers/email/suppression-repository.ts';
import { matchIdOf } from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  readNoticeRows,
  readUnsubscribeTokenRows,
  T0,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { productIdOf } from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  createDispatcherHarness,
  type DispatcherHarness,
  disableTopic,
  emailRequestIdOf,
  EVENING,
  EVENING_NOW,
  eveningDrafts,
  NEXT_DAY_WINDOW,
  recipientIdOf,
  resetDispatchTables,
  seedEveningMatches,
  setSenderInfo,
} from './testing/group-dispatcher-fixtures.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const LIMIT = 20;
const MINUTE = 60_000;

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

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDispatchTables();
});

describe('EmailGroupDispatcher.dispatchNext(送らない扱い)', () => {
  test('送る直前に受信設定と送信の対象者を確かめ直し、受信しない種別と停止中の宛先の通知を理由付きで送らない', async () => {
    await setSenderInfo();
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    await disableTopic(1, 'match_preview');
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: T0 })
      .where(eq(users.id, recipientIdOf(2)));

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 2, skipped: 2, more: false });
    expect(await noticeStates()).toEqual([
      [recipientIdOf(1), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(1), 'match_preview', 'skipped', 'topic_disabled', null],
      [
        recipientIdOf(2),
        'match_result',
        'skipped',
        'recipient_unavailable',
        null,
      ],
      [recipientIdOf(3), 'match_preview', 'sent', null, emailRequestIdOf(2)],
    ]);
    expect(harness.sender.sent[0]?.input).toMatchObject({ next: null });
  });

  test('連絡先の無い宛先と未確認の宛先は送らず、配信停止のトークンの種も作らない', async () => {
    await setSenderInfo();
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await harness.dependencies.notices.record(eveningDrafts().slice(2), T0);
    const contacts = harness.dependencies.contacts;
    const findContact = contacts.findContact.bind(contacts);
    vi.spyOn(contacts, 'findContact').mockImplementation(async (userId) => {
      if (userId === recipientIdOf(2)) {
        return undefined;
      }
      const contact = await findContact(userId);
      return contact === undefined
        ? undefined
        : { ...contact, emailVerified: false };
    });

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 0, skipped: 2, more: false });
    expect(harness.sender.sent).toEqual([]);
    expect(await noticeStates()).toEqual([
      [
        recipientIdOf(2),
        'match_result',
        'skipped',
        'recipient_unavailable',
        null,
      ],
      [
        recipientIdOf(3),
        'match_preview',
        'skipped',
        'email_not_verified',
        null,
      ],
    ]);
    expect(await readUnsubscribeTokenRows()).toEqual([]);
  });

  test('抑止中の宛先は、連絡先のメールアドレスを照合キーにして照合し、大文字を含むアドレスでも送らない', async () => {
    await setSenderInfo();
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await db
      .update(users)
      .set({ email: 'User3@Mail.Example' })
      .where(eq(users.id, recipientIdOf(3)));
    await createSuppressionRepository(db, { now: () => T0 }).record(
      'user3@mail.example',
      { lastReason: 'hard_bounce', lastEventAt: T0, expiresAt: null },
    );
    await recordEvening(harness);
    const findSuppressed = vi.spyOn(
      harness.dependencies.suppressions,
      'findSuppressed',
    );

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 2, skipped: 1, more: false });
    expect(findSuppressed).toHaveBeenCalledTimes(1);
    expect((await noticeStates()).at(-1)).toEqual([
      recipientIdOf(3),
      'match_preview',
      'skipped',
      'suppressed',
      null,
    ]);
  });

  test('送信者情報が未設定なら、計画の理由を残して全ての通知を送らない扱いにし、1時間に1回だけ報告する', async () => {
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    await disableTopic(1, 'match_preview');
    const findContact = vi.spyOn(harness.dependencies.contacts, 'findContact');

    const steps = [
      await harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, 1),
      await harness.dispatcher.dispatchNext(
        EVENING.key,
        new Date(EVENING_NOW.getTime() + 59 * MINUTE),
        1,
      ),
      await harness.dispatcher.dispatchNext(
        EVENING.key,
        new Date(EVENING_NOW.getTime() + 60 * MINUTE),
        1,
      ),
    ];

    expect(steps).toStrictEqual([
      { emails: 0, skipped: 2, more: true },
      { emails: 0, skipped: 1, more: true },
      { emails: 0, skipped: 1, more: true },
    ]);
    expect(harness.incidents).toStrictEqual([
      { kind: 'sender-info-missing', skipped: 1 },
      { kind: 'sender-info-missing', skipped: 1 },
    ]);
    expect(harness.sender.sent).toEqual([]);
    expect(findContact).not.toHaveBeenCalled();
    expect(await noticeStates()).toEqual([
      [
        recipientIdOf(1),
        'match_result',
        'skipped',
        'sender_info_missing',
        null,
      ],
      [recipientIdOf(1), 'match_preview', 'skipped', 'topic_disabled', null],
      [
        recipientIdOf(2),
        'match_result',
        'skipped',
        'sender_info_missing',
        null,
      ],
      [
        recipientIdOf(3),
        'match_preview',
        'skipped',
        'sender_info_missing',
        null,
      ],
    ]);
  });

  test('自分のプロダクトが非公開化された通知は送らず、相手のプロダクトが表示できなければ非公開のプロダクトと示す', async () => {
    await setSenderInfo();
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(1)));

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 2, skipped: 2, more: false });
    expect(await noticeStates()).toEqual([
      [
        recipientIdOf(1),
        'match_result',
        'skipped',
        'own_product_unavailable',
        null,
      ],
      [
        recipientIdOf(1),
        'match_preview',
        'skipped',
        'own_product_unavailable',
        null,
      ],
      [recipientIdOf(2), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(3), 'match_preview', 'sent', null, emailRequestIdOf(2)],
    ]);
    expect(harness.sender.sent.map(({ input }) => input)).toMatchObject([
      { opponentProductName: UNAVAILABLE_PRODUCT_NAME },
      { opponentProductName: UNAVAILABLE_PRODUCT_NAME },
    ]);
  });

  test('送る時点で開始済みのマッチの予告は古い予告として送らず、統合せずに結果だけを送る', async () => {
    await setSenderInfo();
    const harness = createDispatcherHarness();
    await seedEveningMatches();
    await recordEvening(harness);
    await db
      .update(matches)
      .set({ startedAt: NEXT_DAY_WINDOW.startsAt })
      .where(eq(matches.id, matchIdOf(2)));

    const step = await harness.dispatcher.dispatchNext(
      EVENING.key,
      EVENING_NOW,
      LIMIT,
    );

    expect(step).toStrictEqual({ emails: 2, skipped: 2, more: false });
    expect(await noticeStates()).toEqual([
      [recipientIdOf(1), 'match_result', 'sent', null, emailRequestIdOf(1)],
      [recipientIdOf(1), 'match_preview', 'skipped', 'stale', null],
      [recipientIdOf(2), 'match_result', 'sent', null, emailRequestIdOf(2)],
      [recipientIdOf(3), 'match_preview', 'skipped', 'stale', null],
    ]);
    expect(
      harness.sender.sent.some(
        ({ kind }) => kind === NOTIFICATION_MATCH_PREVIEW_KIND,
      ),
    ).toBe(false);
  });
});

describe('EmailGroupDispatcher.dispatchNext(未送信の通知の無い枠)', () => {
  test('未送信のまとめが無ければ何も照会せずに続き無しを返す', async () => {
    const harness = createDispatcherHarness();
    const enabledTopicsOf = vi.spyOn(
      harness.dependencies.preferences,
      'enabledTopicsOf',
    );

    await expect(
      harness.dispatcher.dispatchNext(EVENING.key, EVENING_NOW, LIMIT),
    ).resolves.toStrictEqual({ emails: 0, skipped: 0, more: false });
    expect(enabledTopicsOf).not.toHaveBeenCalled();
  });
});
