import { resetSync } from '@logtape/logtape';
import { afterAll, describe, expect, test } from 'vitest';

import { createEmailKindRegistry } from '../../../lib/core/email/email-kind.ts';
import { EMAIL_KINDS } from '../../../lib/core/email/kinds/index.ts';
import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../../lib/core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { createEmailSender } from '../../../lib/workers/email/email-sender.ts';
import { createMessagePublisher } from '../../../lib/workers/messaging/queue-publisher.ts';
import { configureRecordingLogs } from '../../../test/support/observability-recording.ts';
import type {
  IdentityMailer,
  IdentitySettings,
  UserRecord,
} from '../../application/identity/ports.ts';
import { EmailIdentityMailer } from './email-identity-mailer.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface MailCase {
  readonly label: string;
  readonly kind: string;
  readonly to: string;
  readonly send: (mailer: IdentityMailer, token: string) => Promise<void>;
  readonly input: (token: string) => Record<string, string>;
  readonly linkField?: string;
  readonly deadline?: string;
}

const CLIENT_ORIGIN = 'https://client.example';

const LOCAL_CLIENT_ORIGIN = 'http://localhost:48044';

const SENT_AT = new Date('2026-11-02T03:04:05.678Z');

const fixedClock: Clock = { now: () => new Date(SENT_AT) };

const fixedIds: IdGenerator = { generate: () => '01JBM3Y7Q2M4N5P6R7S8T9V0W1' };

const EXPIRES_AT = new Date('2026-11-03T03:04:05.000Z');

const COMPLETED_AT = new Date('2026-11-02T03:04:05.000Z');

const NICKNAME = 'やまだ たろう';

const CURRENT_EMAIL = 'taro.yamada@mail.example';

const NEW_EMAIL = 'taro.new@mail.example';

const PREVIOUS_EMAIL = 'taro.previous@mail.example';

const USER: UserRecord = {
  id: '01JBM3Y7Q2M4N5P6R7S8T9V0W2',
  status: 'active',
  emailVerifiedAt: null,
  deletedAt: null,
  pseudonymousId: '01JBM3Y7Q2M4N5P6R7S8T9V0W3',
  email: CURRENT_EMAIL,
  passwordHash: '',
  nickname: NICKNAME,
  handle: 'taro0yamada1',
  disposableEmailStatus: null,
  termsAgreedAt: COMPLETED_AT,
  lifecycleVersion: 0,
};

function createToken(): string {
  return crypto
    .getRandomValues(new Uint8Array(32))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
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

function createMailer(
  queue: Queue<QueueEnvelope>,
  clientOrigin: string = CLIENT_ORIGIN,
): IdentityMailer {
  const sender = createEmailSender(
    createMessagePublisher(queue, MESSAGE_CONTRACTS, fixedIds, fixedClock),
    createEmailKindRegistry(EMAIL_KINDS),
  );
  const settings: IdentitySettings = {
    clientOrigin,
    totpIssuer: 'Launch Stadium local',
  };
  return new EmailIdentityMailer(sender, settings);
}

function onlyBody(sent: readonly QueueEnvelope[]): EmailSendBody {
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type).toBe('email.send');
  return sent[0]?.body as EmailSendBody;
}

function countOccurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const LINK_CASES: readonly MailCase[] = [
  {
    label: 'メールアドレスの確認',
    kind: 'identity.email-verification',
    to: CURRENT_EMAIL,
    send: (mailer, token) =>
      mailer.sendEmailVerification(USER, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      verifyUrl: `${CLIENT_ORIGIN}/auth/verify-email#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'verifyUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
  {
    label: 'メールアドレスの変更の確認',
    kind: 'identity.email-change-confirmation',
    to: NEW_EMAIL,
    send: (mailer, token) =>
      mailer.sendEmailChangeConfirmation(USER, NEW_EMAIL, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      confirmUrl: `${CLIENT_ORIGIN}/auth/email-change/confirm#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'confirmUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
  {
    label: 'パスワードリセット',
    kind: 'identity.password-reset',
    to: CURRENT_EMAIL,
    send: (mailer, token) => mailer.sendPasswordReset(USER, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      resetUrl: `${CLIENT_ORIGIN}/auth/password-reset/confirm#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'resetUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
  {
    label: 'パスワードの変更の確認',
    kind: 'identity.password-change-confirmation',
    to: CURRENT_EMAIL,
    send: (mailer, token) =>
      mailer.sendPasswordChangeConfirmation(USER, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      confirmUrl: `${CLIENT_ORIGIN}/auth/password-change/confirm#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'confirmUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
];

const COMPLETION_CASES: readonly MailCase[] = [
  {
    label: 'メールアドレスの変更の完了',
    kind: 'identity.email-changed',
    to: PREVIOUS_EMAIL,
    send: (mailer) =>
      mailer.sendEmailChanged(PREVIOUS_EMAIL, USER, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      changedAt: COMPLETED_AT.toISOString(),
      contactUrl: `${CLIENT_ORIGIN}/contact`,
    }),
  },
  {
    label: 'パスワードリセットの完了',
    kind: 'identity.password-reset-completed',
    to: CURRENT_EMAIL,
    send: (mailer) => mailer.sendPasswordResetCompleted(USER, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      completedAt: COMPLETED_AT.toISOString(),
      contactUrl: `${CLIENT_ORIGIN}/contact`,
    }),
  },
  {
    label: 'パスワードの変更の完了',
    kind: 'identity.password-changed',
    to: CURRENT_EMAIL,
    send: (mailer) => mailer.sendPasswordChanged(USER, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      changedAt: COMPLETED_AT.toISOString(),
      contactUrl: `${CLIENT_ORIGIN}/contact`,
    }),
  },
];

const ALL_CASES = [...LINK_CASES, ...COMPLETION_CASES];

afterAll(() => {
  resetSync();
});

describe('EmailIdentityMailer', () => {
  test('7種のメールの種別をすべて送り分ける', async () => {
    const { queue, sent } = createRecordingQueue();
    const mailer = createMailer(queue);

    for (const mailCase of ALL_CASES) {
      await mailCase.send(mailer, createToken());
    }

    expect(
      sent.map(({ body }) => (body as EmailSendBody).kind).toSorted(),
    ).toStrictEqual(
      EMAIL_KINDS.map(({ name }) => name)
        .filter((name) => name.startsWith('identity.'))
        .toSorted(),
    );
  });

  test.each(LINK_CASES)(
    '$labelのメールは、トークンの有効期限を送信期限にし、リンクのフラグメントにトークンを載せる',
    async ({ kind, to, send, input, deadline }) => {
      const { queue, sent } = createRecordingQueue();
      const token = createToken();

      await send(createMailer(queue), token);

      expect(onlyBody(sent)).toStrictEqual({
        kind,
        to,
        input: input(token),
        deadline,
      });
    },
  );

  test.each(COMPLETION_CASES)(
    '$labelのメールは、送信期限を付けずに問い合わせのリンクを載せる',
    async ({ kind, to, send, input }) => {
      const { queue, sent } = createRecordingQueue();

      await send(createMailer(queue), createToken());

      expect(onlyBody(sent)).toStrictEqual({ kind, to, input: input('') });
    },
  );

  test.each(LINK_CASES)(
    '$labelの送信要求は、トークンの平文をリンクのフラグメントとしてだけ含む',
    async ({ send, linkField }) => {
      const { queue, sent } = createRecordingQueue();
      const token = createToken();

      await send(createMailer(queue), token);

      const body = onlyBody(sent);
      const link = new URL(
        (body.input as Record<string, string>)[linkField ?? ''] ?? '',
      );
      expect(countOccurrences(JSON.stringify(sent), token)).toBe(1);
      expect(link.hash).toBe(`#token=${token}`);
      expect(link.search).toBe('');
      expect(link.pathname).not.toContain(token);
    },
  );

  test.each([
    { label: 'ローカルのHTTP', origin: LOCAL_CLIENT_ORIGIN },
    { label: 'HTTPS', origin: CLIENT_ORIGIN },
  ])(
    '$labelの利用者側のオリジンでリンクを組み、送信要求として受け付けられる',
    async ({ origin }) => {
      const { queue, sent } = createRecordingQueue();
      const token = createToken();
      const mailer = createMailer(queue, origin);

      await mailer.sendEmailVerification(USER, token, EXPIRES_AT);
      await mailer.sendPasswordChanged(USER, COMPLETED_AT);

      expect(sent.map(({ body }) => (body as EmailSendBody).input)).toEqual([
        expect.objectContaining({
          verifyUrl: `${origin}/auth/verify-email#token=${token}`,
        }),
        expect.objectContaining({ contactUrl: `${origin}/contact` }),
      ]);
    },
  );

  test('送信と送信の失敗で、トークンをログにも例外にも出さない', async () => {
    const logs = configureRecordingLogs();
    const { queue } = createRecordingQueue();
    const token = createToken();
    const mailer = createMailer(queue);
    const failingQueue: Queue<QueueEnvelope> = {
      ...queue,
      send: () => Promise.reject(new Error('Queueに送れない')),
    };

    for (const mailCase of LINK_CASES) {
      await mailCase.send(mailer, token);
    }
    const failure = await createMailer(failingQueue)
      .sendPasswordReset(USER, token, EXPIRES_AT)
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(token);
    expect(JSON.stringify(failure)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(token);
  });
});
