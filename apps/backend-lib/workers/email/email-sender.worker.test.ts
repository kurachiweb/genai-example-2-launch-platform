import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  createEmailKindRegistry,
  defineEmailKind,
} from '../../core/email/email-kind.ts';
import type { ExtraHeaders } from '../../core/email/email-headers.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../core/email/kinds/email-delivery-smoke.ts';
import { EMAIL_KINDS } from '../../core/email/kinds/index.ts';
import {
  EmailSendError,
  type EmailSendRequest,
} from '../../core/email/ports.ts';
import {
  EMAIL_SEND_MESSAGE,
  MAX_EMAIL_SEND_BODY_BYTES,
} from '../../core/email/send-message.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import {
  parseEnvelope,
  type QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import type { Clock } from '../../core/time/clock.ts';
import {
  createMessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import { createEmailSender } from './email-sender.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

function createRecordingQueue(): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

const SENT_AT = new Date('2026-10-27T03:04:05.678Z');
const fixedClock: Clock = { now: () => new Date(SENT_AT) };
const REQUEST_ID = '01JBM3Y7Q2M4N5P6R7S8T9V0W1';
const fixedIds: IdGenerator = { generate: () => REQUEST_ID };

const RECIPIENT = 'private-recipient@mail.example';
const SECRET_INPUT_VALUE = 'secret-input-value-7f3a';

const greetingKind = defineEmailKind({
  name: 'test-domain.greeting',
  category: 'notification',
  inputSchema: z.object({
    displayName: z.string().min(1),
    count: z.int().positive(),
  }),
});
type GreetingInput = z.infer<typeof greetingKind.inputSchema>;

const registry = createEmailKindRegistry([
  greetingKind,
  EMAIL_DELIVERY_SMOKE_KIND,
]);

const VALID_INPUT: GreetingInput = { displayName: 'アリス', count: 2 };

const ONE_CLICK_HEADERS: ExtraHeaders = {
  'List-Unsubscribe': '<https://unsubscribe.example/u/abc>',
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
};

function createSubject(queue: Queue<QueueEnvelope>) {
  const publisher = createMessagePublisher(
    queue,
    MESSAGE_CONTRACTS,
    fixedIds,
    fixedClock,
  );
  return createEmailSender(publisher, registry);
}

function greetingRequest(
  overrides: Partial<EmailSendRequest<GreetingInput>> = {},
): EmailSendRequest<GreetingInput> {
  return {
    kind: greetingKind,
    to: RECIPIENT,
    input: VALID_INPUT,
    ...overrides,
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗するはずの送信要求が受け付けられた');
}

function expectEmailSendError(
  error: unknown,
  reason: EmailSendError['reason'],
  leakedValues: readonly string[],
): void {
  expect(error).toBeInstanceOf(EmailSendError);
  expect(error).toMatchObject({ name: 'EmailSendError', reason });
  const { message, cause } = error as Error;
  expect(cause).toBeUndefined();
  for (const value of leakedValues) {
    expect(message).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
  }
}

describe('createEmailSender', () => {
  describe('受け付けた送信要求', () => {
    test('封筒付きのemail.sendのメッセージを本体のQueueへ1件送り、封筒のIDを送信要求の識別子として返す', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      const requestId = await sender.send(greetingRequest());

      expect(requestId).toBe(REQUEST_ID);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        v: 1,
        type: 'email.send',
        id: REQUEST_ID,
        sentAt: '2026-10-27T03:04:05.678Z',
        body: {
          kind: 'test-domain.greeting',
          to: RECIPIENT,
          input: VALID_INPUT,
        },
      });
      expect(parseEnvelope(sent[0])).toEqual({ ok: true, envelope: sent[0] });
      expect(EMAIL_SEND_MESSAGE.schema.safeParse(sent[0]?.body).success).toBe(
        true,
      );
    });

    test('種別の検証規則に合格した結果をテンプレート入力として送り、規則に無い項目を含めない', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      await sender.send(
        greetingRequest({
          input: { ...VALID_INPUT, extra: SECRET_INPUT_VALUE } as GreetingInput,
        }),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toMatchObject({ input: VALID_INPUT });
      expect(JSON.stringify(sent[0])).not.toContain(SECRET_INPUT_VALUE);
    });

    test('送信期限をUTCのISO 8601形式で送信処理へ引き継ぐ', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      await sender.send(
        greetingRequest({ deadline: new Date('2026-10-28T00:00:00.000Z') }),
      );

      expect(sent[0]?.body).toMatchObject({
        deadline: '2026-10-28T00:00:00.000Z',
      });
    });

    test('許可された追加ヘッダーをそのまま送信処理へ引き継ぐ', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      await sender.send(greetingRequest({ headers: ONE_CLICK_HEADERS }));

      expect(sent[0]?.body).toMatchObject({ headers: ONE_CLICK_HEADERS });
    });

    test('送信期限と追加ヘッダーを指定しない要求の本文にはそれらの項目を含めない', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      await sender.send(greetingRequest());

      expect(Object.keys(sent[0]?.body as object)).toEqual([
        'kind',
        'to',
        'input',
      ]);
    });

    test('大きさの上限ちょうどの本文は受け付ける', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);
      const baseBytes = new TextEncoder().encode(
        JSON.stringify({
          kind: greetingKind.name,
          to: RECIPIENT,
          input: { displayName: '', count: 2 },
        }),
      ).byteLength;

      await sender.send(
        greetingRequest({
          input: {
            displayName: 'a'.repeat(MAX_EMAIL_SEND_BODY_BYTES - baseBytes),
            count: 2,
          },
        }),
      );

      expect(sent).toHaveLength(1);
    });

    test('実物のQueueのバインディングへ疎通確認の種別の送信要求を送れる', async () => {
      const publisher = createMessagePublisher(
        env.JOBS_QUEUE,
        MESSAGE_CONTRACTS,
        fixedIds,
        fixedClock,
      );
      const sender = createEmailSender(
        publisher,
        createEmailKindRegistry(EMAIL_KINDS),
      );

      await expect(
        sender.send({
          kind: EMAIL_DELIVERY_SMOKE_KIND,
          to: RECIPIENT,
          input: { requestedAt: '2026-10-27T03:04:05.678Z' },
          deadline: new Date('2026-10-27T04:04:05.678Z'),
        }),
      ).resolves.toBe(REQUEST_ID);
    });
  });

  describe('拒否する送信要求', () => {
    test('登録されていない種別は送らずに理由unknown-kindで失敗する', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);
      const unregisteredKind = defineEmailKind({
        name: 'test-domain.unregistered',
        category: 'transactional',
        inputSchema: z.object({ displayName: z.string() }),
      });

      const error = await captureRejection(
        sender.send({
          kind: unregisteredKind,
          to: RECIPIENT,
          input: { displayName: SECRET_INPUT_VALUE },
        }),
      );

      expectEmailSendError(error, 'unknown-kind', [
        RECIPIENT,
        SECRET_INPUT_VALUE,
      ]);
      expect(sent).toHaveLength(0);
    });

    test('同じ名前の種別でも登録された種別の検証規則で入力を検証する', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);
      const looserKind = defineEmailKind({
        name: greetingKind.name,
        category: 'notification',
        inputSchema: z.object({ displayName: z.string() }),
      });

      const error = await captureRejection(
        sender.send({
          kind: looserKind,
          to: RECIPIENT,
          input: { displayName: SECRET_INPUT_VALUE },
        }),
      );

      expectEmailSendError(error, 'invalid-input', [SECRET_INPUT_VALUE]);
      expect(sent).toHaveLength(0);
    });

    test.each<[string, unknown]>([
      ['必須の項目の欠け', { displayName: SECRET_INPUT_VALUE }],
      ['型の違い', { displayName: SECRET_INPUT_VALUE, count: '2' }],
      ['規則の範囲外', { displayName: SECRET_INPUT_VALUE, count: -1 }],
      ['オブジェクトでない入力', SECRET_INPUT_VALUE],
    ])(
      'テンプレート入力が種別の検証規則に合わない(%s)と送らずに理由invalid-inputで失敗する',
      async (_label, input) => {
        const { queue, sent } = createRecordingQueue();
        const sender = createSubject(queue);

        const error = await captureRejection(
          sender.send(greetingRequest({ input: input as GreetingInput })),
        );

        expectEmailSendError(error, 'invalid-input', [
          RECIPIENT,
          SECRET_INPUT_VALUE,
        ]);
        expect(sent).toHaveLength(0);
      },
    );

    test.each([
      '',
      'private-recipient',
      'private-recipient@',
      '@mail.example',
      'Private Recipient <private-recipient@mail.example>',
      ' private-recipient@mail.example',
      'private-recipient@mail.example\n',
      `${'a'.repeat(243)}@mail.example`,
    ])(
      '宛先%jがメールアドレスの形式でないと送らずに理由invalid-addressで失敗する',
      async (to) => {
        const { queue, sent } = createRecordingQueue();
        const sender = createSubject(queue);

        const error = await captureRejection(
          sender.send(greetingRequest({ to })),
        );

        expectEmailSendError(
          error,
          'invalid-address',
          to === '' ? [] : [to.trim()],
        );
        expect(sent).toHaveLength(0);
      },
    );

    test.each([
      'private-recipient@mail.example,another-recipient@mail.example',
      'private-recipient@mail.example, another-recipient@mail.example',
      'private-recipient@mail.example;another-recipient@mail.example',
    ])('複数の宛先%jは送らずに理由invalid-addressで失敗する', async (to) => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);

      const error = await captureRejection(
        sender.send(greetingRequest({ to })),
      );

      expectEmailSendError(error, 'invalid-address', [RECIPIENT]);
      expect(sent).toHaveLength(0);
    });

    test.each<[string, ExtraHeaders]>([
      ['CC', { Cc: 'another-recipient@mail.example' }],
      ['BCC', { Bcc: 'another-recipient@mail.example' }],
      ['宛先', { To: 'another-recipient@mail.example' }],
      ['返信先', { 'Reply-To': 'another-recipient@mail.example' }],
    ])(
      '%sのヘッダーは送らずに理由invalid-headersで失敗する',
      async (_label, headers) => {
        const { queue, sent } = createRecordingQueue();
        const sender = createSubject(queue);

        const error = await captureRejection(
          sender.send(greetingRequest({ headers })),
        );

        expectEmailSendError(error, 'invalid-headers', [
          'another-recipient@mail.example',
          RECIPIENT,
        ]);
        expect(sent).toHaveLength(0);
      },
    );

    test.each<[string, ExtraHeaders]>([
      ['空の値', { 'List-Id': ' ' }],
      ['改行を含む値', { 'List-Id': `${SECRET_INPUT_VALUE}\r\nBcc: x` }],
      [
        'HTTPSのURIを含まない配信停止',
        { 'List-Unsubscribe': `<mailto:${RECIPIENT}>` },
      ],
      [
        '配信停止のURIが無いワンクリック指定',
        { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      ],
      [
        '大文字小文字だけ違う重複',
        { 'List-Id': SECRET_INPUT_VALUE, 'list-id': SECRET_INPUT_VALUE },
      ],
      ['上限を超える値', { 'List-Id': 'a'.repeat(2049) }],
    ])(
      '追加ヘッダーが%sだと送らずに理由invalid-headersで失敗する',
      async (_label, headers) => {
        const { queue, sent } = createRecordingQueue();
        const sender = createSubject(queue);

        const error = await captureRejection(
          sender.send(greetingRequest({ headers })),
        );

        expectEmailSendError(error, 'invalid-headers', [
          RECIPIENT,
          SECRET_INPUT_VALUE,
        ]);
        expect(sent).toHaveLength(0);
      },
    );

    test.each<[string, Date]>([
      ['無効な日時', new Date(Number.NaN)],
      ['4桁の年で表せない日時', new Date(8.64e15)],
      ['紀元前の日時', new Date('-000001-01-01T00:00:00.000Z')],
      ['日時でない値', '2026-10-28T00:00:00.000Z' as unknown as Date],
    ])(
      '送信期限が%sだと送らずに理由invalid-deadlineで失敗する',
      async (_label, deadline) => {
        const { queue, sent } = createRecordingQueue();
        const sender = createSubject(queue);

        const error = await captureRejection(
          sender.send(greetingRequest({ deadline })),
        );

        expectEmailSendError(error, 'invalid-deadline', [RECIPIENT]);
        expect(sent).toHaveLength(0);
      },
    );

    test('本文が大きさの上限を超えると送らずに理由too-largeで失敗する', async () => {
      const { queue, sent } = createRecordingQueue();
      const sender = createSubject(queue);
      const baseBytes = new TextEncoder().encode(
        JSON.stringify({
          kind: greetingKind.name,
          to: RECIPIENT,
          input: { displayName: '', count: 2 },
        }),
      ).byteLength;
      const oversizedName = `${SECRET_INPUT_VALUE}${'a'.repeat(
        MAX_EMAIL_SEND_BODY_BYTES - baseBytes - SECRET_INPUT_VALUE.length + 1,
      )}`;

      const error = await captureRejection(
        sender.send(
          greetingRequest({ input: { displayName: oversizedName, count: 2 } }),
        ),
      );

      expectEmailSendError(error, 'too-large', [RECIPIENT, SECRET_INPUT_VALUE]);
      expect(sent).toHaveLength(0);
    });

    test('検証は種別・入力・宛先・追加ヘッダー・送信期限の順に行い、最初に合わなかった理由で失敗する', async () => {
      const { queue } = createRecordingQueue();
      const sender = createSubject(queue);
      const invalidEverything = {
        to: 'private-recipient',
        headers: { Cc: 'another-recipient@mail.example' },
        deadline: new Date(Number.NaN),
      };

      await expect(
        sender.send(
          greetingRequest({
            ...invalidEverything,
            input: {} as GreetingInput,
          }),
        ),
      ).rejects.toMatchObject({ reason: 'invalid-input' });
      await expect(
        sender.send(greetingRequest(invalidEverything)),
      ).rejects.toMatchObject({ reason: 'invalid-address' });
      await expect(
        sender.send(greetingRequest({ ...invalidEverything, to: RECIPIENT })),
      ).rejects.toMatchObject({ reason: 'invalid-headers' });
      await expect(
        sender.send(greetingRequest({ deadline: invalidEverything.deadline })),
      ).rejects.toMatchObject({ reason: 'invalid-deadline' });
    });
  });

  describe('Queueへの送信の失敗', () => {
    test('Queueへの送信の失敗は包まずにそのまま呼び出し側へ伝わる', async () => {
      const sendFailure = new Error('Queueへの送信に失敗した');
      const failingQueue: Queue<QueueEnvelope> = {
        ...createRecordingQueue().queue,
        send: () => Promise.reject(sendFailure),
      };
      const sender = createSubject(failingQueue);

      await expect(sender.send(greetingRequest())).rejects.toBe(sendFailure);
    });

    test('送信部品の失敗はEmailSendErrorに包まずにMessagePublishErrorのまま伝わる', async () => {
      const { queue, sent } = createRecordingQueue();
      const publisher = createMessagePublisher(queue, [], fixedIds, fixedClock);
      const sender = createEmailSender(publisher, registry);

      const error = await captureRejection(sender.send(greetingRequest()));

      expect(error).toBeInstanceOf(MessagePublishError);
      expect(error).not.toBeInstanceOf(EmailSendError);
      expect(error).toMatchObject({ reason: 'unknown-type' });
      expect(sent).toHaveLength(0);
    });
  });
});
