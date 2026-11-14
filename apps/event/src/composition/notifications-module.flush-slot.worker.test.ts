import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import {
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../../lib/core/email/kinds/notifications.ts';
import {
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
  NOTIFICATION_RETRY_POLICY,
} from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import { createSequentialIds } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { insertMatches } from '../../lib/workers/match/testing/match-fixtures.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { D1NotificationSlotStore } from '../../lib/workers/notifications/d1-notification-slot-store.ts';
import { MATCH_DAY } from '../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  db,
  readNoticeRows,
  readSlotRow,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import {
  DECIDED,
  emailOf,
  EVENING_NOW,
  NEXT_DAY_WINDOW,
  NEXT_DAY,
  recipientIdOf,
  recipientMatch,
  resetDispatchTables,
  seedRecipient,
  setSenderInfo,
} from '../infrastructure/notifications/testing/group-dispatcher-fixtures.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const EVENING = eveningSlot(MATCH_DAY);

const EVENT_ORIGIN = 'https://event.test.example';

// 収集・送信の続きは1回ずつ遅延再送で届くため、完了までに要る処理の回数より十分多い上限で打ち切る
const MAX_ROUNDS = 10;

const FLUSH_ENVELOPE: QueueEnvelope = {
  v: 1,
  type: FLUSH_NOTIFICATION_SLOT_MESSAGE.type,
  id: '01JD0NTFY00000000000000001',
  sentAt: T0.toISOString(),
  body: { slotKey: EVENING.key },
};

interface SentEnvelope {
  readonly envelope: QueueEnvelope;
  readonly delaySeconds: number | undefined;
}

interface Round {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly resentDelaySeconds: number | undefined;
}

interface EmailSendBodyShape {
  readonly kind: string;
  readonly to: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で1件を処理し、Queueへ送られた封筒を記録する
async function deliver(
  envelope: QueueEnvelope,
  sent: SentEnvelope[],
): Promise<Round> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // 続きの再送とメールの送信要求が後のテストの途中で届かないよう、実際には送らない
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const ctx = createExecutionContext();
  try {
    await createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
      batch,
      env,
      ctx,
    );
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const calls = sendSpy.mock.calls.map(([body, options]) => ({
      envelope: body as QueueEnvelope,
      delaySeconds: options?.delaySeconds,
    }));
    sent.push(...calls);
    const resend = calls
      .filter(({ envelope: sentEnvelope }) =>
        isEnvelopeOf(FLUSH_NOTIFICATION_SLOT_MESSAGE.type, sentEnvelope),
      )
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      resentDelaySeconds: resend?.delaySeconds,
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

// 遅延再送された同じ封筒を、送り直されなくなるまで処理し直す
async function deliverUntilSettled(sent: SentEnvelope[]): Promise<Round[]> {
  const rounds: Round[] = [];
  for (let index = 0; index < MAX_ROUNDS; index += 1) {
    const round = await deliver(FLUSH_ENVELOPE, sent);
    rounds.push(round);
    if (round.resentDelaySeconds === undefined) {
      return rounds;
    }
  }
  throw new Error('送信枠の送り出しが終わらない');
}

function emailBodiesOf(sent: readonly SentEnvelope[]) {
  return sent.flatMap(({ envelope }) =>
    isEnvelopeOf(EMAIL_SEND_MESSAGE.type, envelope)
      ? [{ id: envelope.id, body: envelope.body as EmailSendBodyShape }]
      : [],
  );
}

// 受信者1と2の当日の確定した予選(1が2に勝利)と、受信者3と4の翌日の予選。1と2は勝敗結果、3は開始予告を受信し、4は何も受信しない
async function seedEveningQualifiers(): Promise<void> {
  await seedRecipient(1, ['match_result']);
  await seedRecipient(2, ['match_result']);
  await seedRecipient(3, ['match_preview']);
  await seedRecipient(4, []);
  await insertMatches([
    recipientMatch(
      1,
      [
        { owner: 1, result: 'won', upvoteCount: 12 },
        { owner: 2, result: 'lost', upvoteCount: 9 },
      ],
      DECIDED,
    ),
    recipientMatch(2, [{ owner: 3 }, { owner: 4 }], {
      matchDate: NEXT_DAY,
      startsAt: NEXT_DAY_WINDOW.startsAt,
      endsAt: NEXT_DAY_WINDOW.endsAt,
    }),
  ]);
}

// 前提の機能がそろって送り出しの依頼が記録された夜の枠(期限を待たずに送り出せる)
async function openRequestedEvening(): Promise<void> {
  const slots = new D1NotificationSlotStore(db, createSequentialIds(8000));
  await slots.ensure(EVENING, T0);
  await slots.markDispatchRequested(EVENING.key, T0);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // 本番のQueueの経路は処理の時刻をシステムの時計から読むため、予告のマッチの開始より前の業務時刻23:46に固定する
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(EVENING_NOW);
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await resetDispatchTables();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('送信枠の送り出しのメッセージの処理の登録', () => {
  test('notifications.flush-slotを送り出しの処理へ、通知の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) =>
          contract.type === FLUSH_NOTIFICATION_SLOT_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: FLUSH_NOTIFICATION_SLOT_MESSAGE,
        handler: EVENT_NOTIFICATIONS_TYPES.FlushSlotHandler,
        retry: NOTIFICATION_RETRY_POLICY,
      },
    ]);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});

describe('notifications.flush-slotのQueueの処理', () => {
  test('依頼済みの夜の枠を収集から送信まで進め、通知メールの送信要求を送って枠を完了にする', async () => {
    await setSenderInfo();
    await seedEveningQualifiers();
    await openRequestedEvening();
    const sent: SentEnvelope[] = [];

    const rounds = await deliverUntilSettled(sent);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: 1 },
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    const emails = emailBodiesOf(sent);
    expect(
      emails.map(({ body }) => [body.kind, body.to]).toSorted(),
    ).toStrictEqual(
      [
        [NOTIFICATION_MATCH_RESULT_KIND.name, emailOf(1)],
        [NOTIFICATION_MATCH_RESULT_KIND.name, emailOf(2)],
        [NOTIFICATION_MATCH_PREVIEW_KIND.name, emailOf(3)],
      ].toSorted(),
    );
    for (const { body } of emails) {
      expect(body.headers?.['List-Unsubscribe']).toMatch(
        new RegExp(
          `^<${EVENT_ORIGIN}/unsubscribe\\?token=[A-Za-z0-9_-]+>$`,
          'u',
        ),
      );
      expect(body.headers?.['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      );
    }
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      phase: 'done',
      leaseHolder: null,
      leaseUntil: null,
    });
    const requestIds = new Map(
      emails.map(({ id, body }) => [body.to, id] as const),
    );
    expect(
      (await readNoticeRows())
        .map((row) => [
          row.recipientUserId,
          row.topic,
          row.status,
          row.emailRequestId,
        ])
        .toSorted(),
    ).toStrictEqual(
      [
        [recipientIdOf(1), 'match_result', 'sent', requestIds.get(emailOf(1))],
        [recipientIdOf(2), 'match_result', 'sent', requestIds.get(emailOf(2))],
        [recipientIdOf(3), 'match_preview', 'sent', requestIds.get(emailOf(3))],
      ].toSorted(),
    );
  });

  test('完了した枠へ同じメッセージが再び届いても、送信要求を増やさずに完了する', async () => {
    await setSenderInfo();
    await seedEveningQualifiers();
    await openRequestedEvening();
    await deliverUntilSettled([]);
    const sent: SentEnvelope[] = [];

    const rounds = await deliverUntilSettled(sent);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    expect(emailBodiesOf(sent)).toStrictEqual([]);
    expect((await readSlotRow(EVENING.key))?.phase).toBe('done');
  });

  test('枠が無い送信枠のキーは、リースを取らずに完了する', async () => {
    const rounds = await deliverUntilSettled([]);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    await expect(readSlotRow(EVENING.key)).resolves.toBeUndefined();
  });
});
