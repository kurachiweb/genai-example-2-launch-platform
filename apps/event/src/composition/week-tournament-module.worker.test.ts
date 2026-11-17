import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { weekTournamentEntries } from '../../db/schema/tournament/week-tournament-entries.ts';
import { ultrasActivations } from '../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../db/schema/ultras/ultras-notices.ts';
import { ultrasSubscriptions } from '../../db/schema/ultras/ultras-subscriptions.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../lib/core/ultras/activation-message.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  activatedSubscriptionRow,
  insertActivationRow,
  insertSubscriptionRow,
  newActivationRow,
} from '../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
} from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import { AccountEntryLossHandler } from '../application/week-tournament/account-entry-loss-handler.ts';
import { EntryUnlinkHandler } from '../application/week-tournament/entry-unlink-handler.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { ProductEntryLossHandler } from '../application/week-tournament/product-entry-loss-handler.ts';
import { QualifierEntryHandler } from '../application/week-tournament/qualifier-entry-handler.ts';
import { RoundProgressHandler } from '../application/week-tournament/round-progress-handler.ts';
import { WeekEntrySupplementProvider } from '../application/week-tournament/week-entry-supplement-provider.ts';
import { WeekOpenEntryCheckoutExpiryHandler } from '../application/week-tournament/week-open-entry-checkout-expiry-handler.ts';
import { WeekUltrasEntryExemptionHandler } from '../application/week-tournament/week-ultras-entry-exemption-handler.ts';
import worker from '../index.ts';
import { MODULES } from './modules.ts';
import { EVENT_WEEK_TOURNAMENT_MODULE } from './week-tournament-module.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const IMPLEMENTATIONS = [
  ['QualifierEntryHandler', QualifierEntryHandler],
  ['RoundProgressHandler', RoundProgressHandler],
  ['ProductEntryLossHandler', ProductEntryLossHandler],
  ['AccountEntryLossHandler', AccountEntryLossHandler],
  ['EntryUnlinkHandler', EntryUnlinkHandler],
  ['WeekUltrasEntryExemptionHandler', WeekUltrasEntryExemptionHandler],
  ['WeekOpenEntryCheckoutExpiryHandler', WeekOpenEntryCheckoutExpiryHandler],
  ['WeekEntrySupplementProvider', WeekEntrySupplementProvider],
] as const;

// メッセージの本文の知らせのIDはULIDの形でなければデッドレターへ移るため、ULIDの文字だけで作る
const ACTIVATION_ID = '01JD0WEEKACT1VAT10N0000001';

const OWNER = 1;

const OTHER_OWNER = 2;

const ENTRY = 1;

const ENTITLED_ENTRY = 2;

const OTHER_ENTRY = 3;

// 予選の勝利(2026-11-21T08:00Z)の後、決済期限(翌週月曜日23:35)より前
const ACTIVATED_AT = new Date('2026-11-22T00:00:00.000Z');

// 先に届いた別の知らせで参加資格を得た時刻
const ENTITLED_AT = new Date('2026-11-21T12:00:00.000Z');

let envelopeCount = 0;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function activationEnvelope(): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
    id: `01JD0WEEKMSG${String(envelopeCount).padStart(14, '0')}`,
    sentAt: T0.toISOString(),
    body: { activationId: ACTIVATION_ID },
  };
}

// 本番と同じエントリのqueueハンドラーで処理する
async function dispatch(
  envelope: QueueEnvelope,
  attempts = 1,
): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  await queue(batch, env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
  expect(deadLetterSpy).not.toHaveBeenCalled();
  return {
    acked: explicitAcks.includes(message.id),
    retried: retryMessages.some(({ msgId }) => msgId === message.id),
  };
}

async function readEntry(index: number) {
  const [row] = await db
    .select({
      status: weekTournamentEntries.status,
      entitlementSource: weekTournamentEntries.entitlementSource,
      entitledAt: weekTournamentEntries.entitledAt,
    })
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

// 加入の行は利用者を参照するため、利用者を消すブラケット・マッチ・プロダクトの補助より先に消す
async function clearTables(): Promise<void> {
  await db.delete(ultrasNotices);
  await db.delete(ultrasActivations);
  await db.delete(ultrasSubscriptions);
  await clearWeekTournamentTables();
}

async function insertEntriesWithActivation(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(OTHER_OWNER);
  await insertProduct(ENTRY, OWNER);
  await insertProduct(ENTITLED_ENTRY, OWNER);
  await insertProduct(OTHER_ENTRY, OTHER_OWNER);
  for (const index of [ENTRY, ENTITLED_ENTRY, OTHER_ENTRY]) {
    await insertLaunch(index, index);
  }
  await insertWeekTournaments([{ index: 1 }]);
  await insertWeekEntries([
    {
      index: ENTRY,
      tournament: 1,
      launch: ENTRY,
      product: ENTRY,
      owner: OWNER,
    },
    {
      index: ENTITLED_ENTRY,
      tournament: 1,
      launch: ENTITLED_ENTRY,
      product: ENTITLED_ENTRY,
      owner: OWNER,
      columns: {
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: ENTITLED_AT,
      },
    },
    {
      index: OTHER_ENTRY,
      tournament: 1,
      launch: OTHER_ENTRY,
      product: OTHER_ENTRY,
      owner: OTHER_OWNER,
    },
  ]);
  await insertSubscriptionRow(activatedSubscriptionRow(OWNER));
  await insertActivationRow(
    newActivationRow(OWNER, { id: ACTIVATION_ID, activatedAt: ACTIVATED_AT }),
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧へのWeekトーナメントの処理の登録', () => {
  test('eventのWeekトーナメントのモジュールを、Weekトーナメントとブラケットの共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(
      MODULES.filter((module) => module === EVENT_WEEK_TOURNAMENT_MODULE),
    ).toHaveLength(1);
    expect(EVENT_WEEK_TOURNAMENT_MODULE.name).toBe('event-week-tournament');
    expect(MODULES.indexOf(EVENT_WEEK_TOURNAMENT_MODULE)).toBeGreaterThan(
      names.indexOf('week-tournament-platform'),
    );
    expect(MODULES.indexOf(EVENT_WEEK_TOURNAMENT_MODULE)).toBeGreaterThan(
      names.indexOf('tournament-platform'),
    );
  });

  test('解決を確かめる識別子はEVENT_WEEK_TOURNAMENT_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(EVENT_WEEK_TOURNAMENT_TYPES).toSorted(),
    );
  });

  test.each(IMPLEMENTATIONS)(
    'queue経路の処理単位のコンテナから%sを実装のクラスに解決する',
    (name, implementation) => {
      expect(
        createContainer().get(EVENT_WEEK_TOURNAMENT_TYPES[name]),
      ).toBeInstanceOf(implementation);
    },
  );
});

describe('加入が有効になった知らせによる参加費の免除(tournament-week.ultras-entry-exemption)', () => {
  test('本番のqueueの経路で、加入した投稿者の受付中の枠にUltrasの参加資格を与え、既に参加資格を得た枠と他の投稿者の枠は書き換えない。同じ知らせの再配信でも参加資格を得た時刻は変わらない', async () => {
    await insertEntriesWithActivation();
    expect(ACTIVATED_AT.getTime()).toBeLessThan(
      WEEK_WINDOW.deadlineAt.getTime(),
    );

    const first = await dispatch(activationEnvelope());
    const granted = await readEntry(ENTRY);

    expect(first).toStrictEqual({ acked: true, retried: false });
    expect(granted).toMatchObject({
      status: 'entitled',
      entitlementSource: 'ultras',
    });
    expect(granted?.entitledAt).toBeInstanceOf(Date);
    expect(await readEntry(ENTITLED_ENTRY)).toStrictEqual({
      status: 'entitled',
      entitlementSource: 'ultras',
      entitledAt: ENTITLED_AT,
    });
    expect(await readEntry(OTHER_ENTRY)).toStrictEqual({
      status: 'awaiting_payment',
      entitlementSource: null,
      entitledAt: null,
    });

    const second = await dispatch(activationEnvelope(), 2);

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(await readEntry(ENTRY)).toStrictEqual(granted);
  });
});
