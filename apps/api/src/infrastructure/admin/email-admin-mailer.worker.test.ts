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
  AdminMailer,
  AdminRecord,
  AdminSettings,
} from '../../application/admin/ports.ts';
import { EmailAdminMailer } from './email-admin-mailer.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface MailCase {
  readonly label: string;
  readonly kind: string;
  readonly to: string;
  readonly send: (mailer: AdminMailer, token: string) => Promise<void>;
  readonly input: (token: string) => Record<string, string>;
  readonly linkField?: string;
  readonly deadline?: string;
}

const ADMIN_ORIGIN = 'https://admin.example';

const LOCAL_ADMIN_ORIGIN = 'http://localhost:48045';

const SENT_AT = new Date('2026-11-02T03:04:05.678Z');

const fixedClock: Clock = { now: () => new Date(SENT_AT) };

const fixedIds: IdGenerator = { generate: () => '01JBM3Y7Q2M4N5P6R7S8T9V0W1' };

const EXPIRES_AT = new Date('2026-11-03T03:04:05.000Z');

const COMPLETED_AT = new Date('2026-11-02T03:04:05.000Z');

const NICKNAME = '運営 はなこ';

const CURRENT_EMAIL = 'hanako.admin@mail.example';

const NEW_EMAIL = 'hanako.new@mail.example';

const PREVIOUS_EMAIL = 'hanako.previous@mail.example';

const INVITEE_EMAIL = 'invitee@mail.example';

const ADMIN: AdminRecord = {
  id: '01JBM3Y7Q2M4N5P6R7S8T9V0W2',
  role: 'moderator',
  status: 'active',
  invitationExpiresAt: null,
  email: CURRENT_EMAIL,
  passwordHash: 'hash',
  nickname: NICKNAME,
  title: null,
  avatarFileId: null,
  createdAt: COMPLETED_AT,
  activatedAt: COMPLETED_AT,
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
  adminOrigin: string = ADMIN_ORIGIN,
): AdminMailer {
  const sender = createEmailSender(
    createMessagePublisher(queue, MESSAGE_CONTRACTS, fixedIds, fixedClock),
    createEmailKindRegistry(EMAIL_KINDS),
  );
  const settings: AdminSettings = {
    adminOrigin,
    totpIssuer: 'Launch Stadium Admin local',
  };
  return new EmailAdminMailer(sender, settings);
}

function onlyBody(sent: readonly QueueEnvelope[]): EmailSendBody {
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type).toBe('email.send');
  return sent[0]?.body as EmailSendBody;
}

function countOccurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

async function failureOf(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const LINK_CASES: readonly MailCase[] = [
  {
    label: '招待',
    kind: 'admin.invitation',
    to: INVITEE_EMAIL,
    send: (mailer, token) =>
      mailer.sendInvitation(INVITEE_EMAIL, token, EXPIRES_AT),
    input: (token) => ({
      invitationUrl: `${ADMIN_ORIGIN}/auth/invitation#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'invitationUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
  {
    label: 'メールアドレスの変更の確認',
    kind: 'admin.email-change-confirmation',
    to: NEW_EMAIL,
    send: (mailer, token) =>
      mailer.sendEmailChangeConfirmation(ADMIN, NEW_EMAIL, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      confirmUrl: `${ADMIN_ORIGIN}/auth/email-change/confirm#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'confirmUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
  {
    label: 'パスワードリセット',
    kind: 'admin.password-reset',
    to: CURRENT_EMAIL,
    send: (mailer, token) => mailer.sendPasswordReset(ADMIN, token, EXPIRES_AT),
    input: (token) => ({
      nickname: NICKNAME,
      resetUrl: `${ADMIN_ORIGIN}/auth/password-reset/confirm#token=${token}`,
      expiresAt: EXPIRES_AT.toISOString(),
    }),
    linkField: 'resetUrl',
    deadline: EXPIRES_AT.toISOString(),
  },
];

const COMPLETION_CASES: readonly MailCase[] = [
  {
    label: 'メールアドレスの変更の完了',
    kind: 'admin.email-changed',
    to: PREVIOUS_EMAIL,
    send: (mailer) =>
      mailer.sendEmailChanged(PREVIOUS_EMAIL, ADMIN, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      changedAt: COMPLETED_AT.toISOString(),
    }),
  },
  {
    label: 'パスワードリセットの完了',
    kind: 'admin.password-reset-completed',
    to: CURRENT_EMAIL,
    send: (mailer) => mailer.sendPasswordResetCompleted(ADMIN, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      completedAt: COMPLETED_AT.toISOString(),
    }),
  },
  {
    label: 'パスワードの変更の完了',
    kind: 'admin.password-changed',
    to: CURRENT_EMAIL,
    send: (mailer) => mailer.sendPasswordChanged(ADMIN, COMPLETED_AT),
    input: () => ({
      nickname: NICKNAME,
      changedAt: COMPLETED_AT.toISOString(),
    }),
  },
];

const ALL_CASES = [...LINK_CASES, ...COMPLETION_CASES];

const NICKNAME_CASES = ALL_CASES.filter(
  ({ kind }) => kind !== 'admin.invitation',
);

afterAll(() => {
  resetSync();
});

describe('EmailAdminMailer', () => {
  test('6種のメールの種別をすべて送り分ける', async () => {
    const { queue, sent } = createRecordingQueue();
    const mailer = createMailer(queue);

    for (const mailCase of ALL_CASES) {
      await mailCase.send(mailer, createToken());
    }

    expect(
      sent.map(({ body }) => (body as EmailSendBody).kind).toSorted(),
    ).toStrictEqual(
      EMAIL_KINDS.map(({ name }) => name)
        .filter((name) => name.startsWith('admin.'))
        .toSorted(),
    );
  });

  test.each(LINK_CASES)(
    '$labelのメールは、トークンの有効期限を送信期限にし、管理者側のリンクのフラグメントにトークンを載せる',
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
    '$labelのメールは、送信期限もリンクも付けずに日時を載せる',
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
      expect(link.origin).toBe(ADMIN_ORIGIN);
      expect(link.hash).toBe(`#token=${token}`);
      expect(link.search).toBe('');
      expect(link.pathname).not.toContain(token);
    },
  );

  test.each([
    { label: 'ローカルのHTTP', origin: LOCAL_ADMIN_ORIGIN },
    { label: 'HTTPS', origin: ADMIN_ORIGIN },
  ])(
    '$labelの管理者側のオリジンでリンクを組み、送信要求として受け付けられる',
    async ({ origin }) => {
      const { queue, sent } = createRecordingQueue();
      const token = createToken();
      const mailer = createMailer(queue, origin);

      await mailer.sendInvitation(INVITEE_EMAIL, token, EXPIRES_AT);

      expect(sent.map(({ body }) => (body as EmailSendBody).input)).toEqual([
        expect.objectContaining({
          invitationUrl: `${origin}/auth/invitation#token=${token}`,
        }),
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
    const failures = await Promise.all(
      LINK_CASES.map(({ send }) =>
        failureOf(send(createMailer(failingQueue), token)),
      ),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(token);
      expect(JSON.stringify(failure)).not.toContain(token);
    }
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  test('送信の失敗の例外のメッセージに宛先のメールアドレスを含めない', async () => {
    const { queue } = createRecordingQueue();
    const failingMailer = createMailer({
      ...queue,
      send: () => Promise.reject(new Error('Queueに送れない')),
    });
    const invalidAddressMailer = createMailer(queue);

    const failures = await Promise.all([
      ...ALL_CASES.map(({ send }) =>
        failureOf(send(failingMailer, createToken())),
      ),
      failureOf(
        invalidAddressMailer.sendInvitation(
          'not-an-address',
          createToken(),
          EXPIRES_AT,
        ),
      ),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      for (const address of [
        CURRENT_EMAIL,
        NEW_EMAIL,
        PREVIOUS_EMAIL,
        INVITEE_EMAIL,
        'not-an-address',
      ]) {
        expect((failure as Error).message).not.toContain(address);
        expect(String(failure)).not.toContain(address);
      }
    }
  });

  test.each(NICKNAME_CASES)(
    '$labelのメールは、ニックネームの無い管理者には送らずに宛先を含まない例外を投げる',
    async ({ send }) => {
      const { queue, sent } = createRecordingQueue();
      const mailer = createMailer(queue);
      const nameless: AdminRecord = { ...ADMIN, nickname: null };
      const withoutNickname: AdminMailer = {
        sendInvitation: (to, token, expiresAt) =>
          mailer.sendInvitation(to, token, expiresAt),
        sendEmailChangeConfirmation: (_admin, newEmail, token, expiresAt) =>
          mailer.sendEmailChangeConfirmation(
            nameless,
            newEmail,
            token,
            expiresAt,
          ),
        sendEmailChanged: (previousEmail, _admin, at) =>
          mailer.sendEmailChanged(previousEmail, nameless, at),
        sendPasswordReset: (_admin, token, expiresAt) =>
          mailer.sendPasswordReset(nameless, token, expiresAt),
        sendPasswordResetCompleted: (_admin, at) =>
          mailer.sendPasswordResetCompleted(nameless, at),
        sendPasswordChanged: (_admin, at) =>
          mailer.sendPasswordChanged(nameless, at),
      };

      const failure = await failureOf(send(withoutNickname, createToken()));

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain('@mail.example');
      expect(sent).toHaveLength(0);
    },
  );
});
