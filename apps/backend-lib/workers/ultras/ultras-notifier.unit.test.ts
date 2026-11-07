import { describe, expect, test } from 'bun:test';

import {
  ULTRAS_CANCELLATION_ACCEPTED_KIND,
  ULTRAS_PAYMENT_FAILED_KIND,
} from '../../core/email/kinds/ultras.ts';
import type { EmailSender, EmailSendRequest } from '../../core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { NoticeStore, UltrasNoticeRow } from '../../core/ultras/ports.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { EmailUltrasNotifier, noticePayloadOf } from './ultras-notifier.ts';

const CLIENT_SITE_ORIGIN = 'https://client.example';
const PLAN_URL = 'https://client.example/settings/plan';
const NOW = new Date('2026-11-06T04:21:00.000Z');
const ACCEPTED_AT = new Date('2026-11-05T10:15:30.000Z');
const BENEFIT_ENDS_AT = new Date('2026-12-01T15:00:00.000Z');
const STRIPE_SUBSCRIPTION_ID = 'sub_ultras_0001';
const clock: Clock = { now: () => NOW };

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [attribute: string]: unknown;
}

interface RecordingSender {
  readonly sender: EmailSender;
  readonly sent: EmailSendRequest<unknown>[];
}

interface RecordingContactDirectory {
  readonly contacts: UserContactDirectory;
  readonly lookedUp: string[];
}

interface NoticeMark {
  readonly id: string;
  readonly at: Date;
}

interface RecordingNoticeStore {
  readonly store: NoticeStore;
  readonly requested: NoticeMark[];
  readonly skipped: NoticeMark[];
}

function userIdOf(index: number): string {
  return `01JC0USER${String(index).padStart(17, '0')}`;
}

function noticeIdOf(index: number): string {
  return `01JC0NOTICE${String(index).padStart(15, '0')}`;
}

function contactOf(
  index: number,
  overrides: Partial<UserContact> = {},
): UserContact {
  return {
    userId: userIdOf(index),
    email: `user${String(index)}@mail.example`,
    nickname: `利用者${String(index)}`,
    emailVerified: true,
    ...overrides,
  };
}

function paymentFailedNotice(
  index: number,
  overrides: Partial<UltrasNoticeRow> = {},
): UltrasNoticeRow {
  return {
    id: noticeIdOf(index),
    userId: userIdOf(1),
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    kind: 'payment_failed',
    dedupeKey: `payment_failed:${STRIPE_SUBSCRIPTION_ID}:${String(ACCEPTED_AT.getTime())}`,
    payload: noticePayloadOf({ acceptedAt: ACCEPTED_AT, benefitEndsAt: null }),
    status: 'pending',
    finishedAt: null,
    createdAt: ACCEPTED_AT,
    ...overrides,
  };
}

function cancellationAcceptedNotice(
  index: number,
  overrides: Partial<UltrasNoticeRow> = {},
): UltrasNoticeRow {
  return paymentFailedNotice(index, {
    kind: 'cancellation_accepted',
    dedupeKey: `cancellation_accepted:${STRIPE_SUBSCRIPTION_ID}:${String(ACCEPTED_AT.getTime())}`,
    payload: noticePayloadOf({
      acceptedAt: ACCEPTED_AT,
      benefitEndsAt: BENEFIT_ENDS_AT,
    }),
    ...overrides,
  });
}

// 実際の送信要求と同じく、入力が種別の検証規則に合わなければ拒否する
function createRecordingSender(
  failWhen?: (request: EmailSendRequest<unknown>) => Error | undefined,
): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  const sender: EmailSender = {
    send: <TInput>(request: EmailSendRequest<TInput>) => {
      const failure = failWhen?.(request);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      request.kind.inputSchema.parse(request.input);
      sent.push(request);
      return Promise.resolve(
        `01JC0EMAIL${String(sent.length).padStart(16, '0')}`,
      );
    },
  };
  return { sender, sent };
}

// 退会済み・物理削除済みの利用者は登録しない。停止中の利用者は宛先を返す
function createContactDirectory(
  contacts: readonly UserContact[] = [contactOf(1)],
): RecordingContactDirectory {
  const byUserId = new Map(
    contacts.map((contact) => [contact.userId, contact]),
  );
  const lookedUp: string[] = [];
  return {
    contacts: {
      findContact: (userId) => {
        lookedUp.push(userId);
        return Promise.resolve(byUserId.get(userId));
      },
    },
    lookedUp,
  };
}

function unused(): never {
  throw new Error('このテストでは使わない操作です');
}

function createRecordingNoticeStore(
  rows: readonly UltrasNoticeRow[] = [],
  markRequestedResult: 'updated' | 'not_pending' = 'updated',
): RecordingNoticeStore {
  const requested: NoticeMark[] = [];
  const skipped: NoticeMark[] = [];
  const store: NoticeStore = {
    findPendingBySubscription: (stripeSubscriptionId) =>
      Promise.resolve(
        rows.filter(
          (row) =>
            row.stripeSubscriptionId === stripeSubscriptionId &&
            row.status === 'pending',
        ),
      ),
    findPendingBefore: unused,
    markRequested: (id, at) => {
      requested.push({ id, at });
      return Promise.resolve(markRequestedResult);
    },
    markSkipped: (id, at) => {
      skipped.push({ id, at });
      return Promise.resolve();
    },
    deleteFinishedBefore: unused,
  };
  return { store, requested, skipped };
}

async function rejectionOf(task: Promise<unknown>): Promise<unknown> {
  try {
    await task;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

function withoutKey(
  payload: UltrasNoticeRow['payload'],
  key: string,
): UltrasNoticeRow['payload'] {
  return Object.fromEntries(
    Object.entries(payload).filter(([name]) => name !== key),
  );
}

function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

function notifierWith(
  parts: {
    readonly appName?: 'api' | 'event';
    readonly sender?: EmailSender;
    readonly contacts?: UserContactDirectory;
    readonly notices?: NoticeStore;
  } = {},
): EmailUltrasNotifier {
  return new EmailUltrasNotifier({
    appName: parts.appName ?? 'api',
    notices: parts.notices ?? createRecordingNoticeStore().store,
    contacts: parts.contacts ?? createContactDirectory().contacts,
    emails: parts.sender ?? createRecordingSender().sender,
    clock,
    clientSiteOrigin: CLIENT_SITE_ORIGIN,
  });
}

function serialized(logs: readonly LoggedObject[]): string {
  return JSON.stringify(logs);
}

describe('EmailUltrasNotifier', () => {
  describe('send', () => {
    test('支払いの失敗の依頼を、宛先のメールアドレスへ宛名のニックネームとプラン管理画面のURLで依頼し、依頼の後に現在時刻で依頼済みにする', async () => {
      const { sender, sent } = createRecordingSender();
      const { store, requested, skipped } = createRecordingNoticeStore();
      const notifier = notifierWith({ sender, notices: store });

      const outcome = await notifier.send(paymentFailedNotice(1));

      expect(outcome).toBe('requested');
      expect(sent).toEqual([
        {
          kind: ULTRAS_PAYMENT_FAILED_KIND,
          to: 'user1@mail.example',
          input: { nickname: '利用者1', planUrl: PLAN_URL },
        },
      ]);
      expect(requested).toEqual([{ id: noticeIdOf(1), at: NOW }]);
      expect(skipped).toEqual([]);
    });

    test('解約の受付の依頼は、内容の受け付けた日時と特典の終了日時を入力に写す', async () => {
      const { sender, sent } = createRecordingSender();
      const { store, requested } = createRecordingNoticeStore();
      const notifier = notifierWith({ sender, notices: store });

      const outcome = await notifier.send(cancellationAcceptedNotice(2));

      expect(outcome).toBe('requested');
      expect(sent).toEqual([
        {
          kind: ULTRAS_CANCELLATION_ACCEPTED_KIND,
          to: 'user1@mail.example',
          input: {
            nickname: '利用者1',
            acceptedAt: '2026-11-05T10:15:30.000Z',
            benefitEndsAt: '2026-12-01T15:00:00.000Z',
            planUrl: PLAN_URL,
          },
        },
      ]);
      expect(requested).toEqual([{ id: noticeIdOf(2), at: NOW }]);
    });

    test('宛先が引けない利用者(退会済み・物理削除済み)には依頼せず、現在時刻で対象外として記録する', async () => {
      const { sender, sent } = createRecordingSender();
      const { store, requested, skipped } = createRecordingNoticeStore();
      const notifier = notifierWith({
        sender,
        notices: store,
        contacts: createContactDirectory([]).contacts,
      });

      const outcome = await notifier.send(paymentFailedNotice(1));

      expect(outcome).toBe('skipped');
      expect(sent).toEqual([]);
      expect(requested).toEqual([]);
      expect(skipped).toEqual([{ id: noticeIdOf(1), at: NOW }]);
    });

    test('停止中など宛先が返る利用者には、メールアドレスの確認の状態によらず依頼する', async () => {
      const { sender, sent } = createRecordingSender();
      const notifier = notifierWith({
        sender,
        contacts: createContactDirectory([
          contactOf(1, { emailVerified: false }),
        ]).contacts,
      });

      const outcome = await notifier.send(paymentFailedNotice(1));

      expect(outcome).toBe('requested');
      expect(sent).toHaveLength(1);
    });

    test.each(['requested', 'skipped'] as const)(
      '状態が%sの依頼は宛先を引かず依頼せず、依頼待ちでないと返す',
      async (status) => {
        const { sender, sent } = createRecordingSender();
        const { store, requested, skipped } = createRecordingNoticeStore();
        const directory = createContactDirectory();
        const notifier = notifierWith({
          sender,
          notices: store,
          contacts: directory.contacts,
        });

        const outcome = await notifier.send(
          paymentFailedNotice(1, { status, finishedAt: NOW }),
        );

        expect(outcome).toBe('not_pending');
        expect(directory.lookedUp).toEqual([]);
        expect(sent).toEqual([]);
        expect(requested).toEqual([]);
        expect(skipped).toEqual([]);
      },
    );

    test('依頼に失敗したら依頼済みにせず、例外をそのまま投げる', async () => {
      const { sender, sent } = createRecordingSender(
        () => new Error('email unavailable'),
      );
      const { store, requested, skipped } = createRecordingNoticeStore();
      const notifier = notifierWith({ sender, notices: store });

      const error = await rejectionOf(notifier.send(paymentFailedNotice(1)));

      expect(error).toMatchObject({ message: 'email unavailable' });
      expect(sent).toEqual([]);
      expect(requested).toEqual([]);
      expect(skipped).toEqual([]);
    });

    test('依頼の後の記録で依頼待ちでなかったら、依頼待ちでないと返す', async () => {
      const { sender, sent } = createRecordingSender();
      const { store } = createRecordingNoticeStore([], 'not_pending');
      const notifier = notifierWith({ sender, notices: store });

      const outcome = await notifier.send(paymentFailedNotice(1));

      expect(outcome).toBe('not_pending');
      expect(sent).toHaveLength(1);
    });

    test.each(['benefitEndsAt', 'acceptedAt'])(
      '%sが内容に無い解約の受付の依頼は、依頼せず対象外として記録し、依頼のIDと種別を添えたwarnのログを出す',
      async (missingKey) => {
        const logs = recordLogs('event');
        const { sender, sent } = createRecordingSender();
        const { store, requested, skipped } = createRecordingNoticeStore();
        const notifier = notifierWith({
          appName: 'event',
          sender,
          notices: store,
        });
        const payload = withoutKey(
          cancellationAcceptedNotice(3).payload,
          missingKey,
        );

        const outcome = await notifier.send(
          cancellationAcceptedNotice(3, { payload }),
        );

        expect(outcome).toBe('skipped');
        expect(sent).toEqual([]);
        expect(requested).toEqual([]);
        expect(skipped).toEqual([{ id: noticeIdOf(3), at: NOW }]);
        expect(logs).toMatchObject([
          {
            level: 'warning',
            category: 'event.application.ultras',
            noticeId: noticeIdOf(3),
            kind: 'cancellation_accepted',
            reason:
              missingKey === 'acceptedAt'
                ? 'missing_accepted_at'
                : 'missing_benefit_ends_at',
          },
        ]);
        expect(serialized(logs)).not.toContain('user1@mail.example');
        expect(serialized(logs)).not.toContain('利用者1');
      },
    );

    test.each([
      ['acceptedAt', 'invalid_accepted_at'],
      ['benefitEndsAt', 'invalid_benefit_ends_at'],
    ])(
      '%sがISO 8601の瞬時でない解約の受付の依頼は、依頼せず対象外として記録し、理由を添えたwarnのログを出す',
      async (invalidKey, reason) => {
        const logs = recordLogs();
        const { sender, sent } = createRecordingSender();
        const { store, requested, skipped } = createRecordingNoticeStore();
        const notifier = notifierWith({ sender, notices: store });
        const payload = {
          ...cancellationAcceptedNotice(4).payload,
          [invalidKey]: '2026-11-05 10:15',
        };

        const outcome = await notifier.send(
          cancellationAcceptedNotice(4, { payload }),
        );

        expect(outcome).toBe('skipped');
        expect(sent).toEqual([]);
        expect(requested).toEqual([]);
        expect(skipped).toEqual([{ id: noticeIdOf(4), at: NOW }]);
        expect(logs).toMatchObject([
          {
            level: 'warning',
            category: 'api.application.ultras',
            noticeId: noticeIdOf(4),
            kind: 'cancellation_accepted',
            reason,
          },
        ]);
      },
    );
  });

  describe('sendPendingFor', () => {
    test('定期課金の依頼待ちを返された順にすべて依頼し、依頼済みにする', async () => {
      const { sender, sent } = createRecordingSender();
      const { store, requested } = createRecordingNoticeStore([
        paymentFailedNotice(1),
        cancellationAcceptedNotice(2),
        paymentFailedNotice(3, { stripeSubscriptionId: 'sub_ultras_0002' }),
        paymentFailedNotice(4, { status: 'requested', finishedAt: NOW }),
      ]);
      const notifier = notifierWith({ sender, notices: store });

      await notifier.sendPendingFor(STRIPE_SUBSCRIPTION_ID);

      expect(sent.map((request) => request.kind.name)).toEqual([
        'ultras.payment-failed',
        'ultras.cancellation-accepted',
      ]);
      expect(requested).toEqual([
        { id: noticeIdOf(1), at: NOW },
        { id: noticeIdOf(2), at: NOW },
      ]);
    });

    test('1件の依頼の失敗は依頼のIDと定期課金のIDを添えたwarnのログに残し、依頼待ちのまま残して残りの依頼を続ける', async () => {
      const logs = recordLogs();
      const { sender, sent } = createRecordingSender((request) =>
        request.kind.name === 'ultras.payment-failed'
          ? new Error('email unavailable')
          : undefined,
      );
      const { store, requested, skipped } = createRecordingNoticeStore([
        paymentFailedNotice(1),
        cancellationAcceptedNotice(2),
      ]);
      const notifier = notifierWith({ sender, notices: store });

      await notifier.sendPendingFor(STRIPE_SUBSCRIPTION_ID);

      expect(sent.map((request) => request.kind.name)).toEqual([
        'ultras.cancellation-accepted',
      ]);
      expect(requested).toEqual([{ id: noticeIdOf(2), at: NOW }]);
      expect(skipped).toEqual([]);
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'api.application.ultras',
          noticeId: noticeIdOf(1),
          kind: 'payment_failed',
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          error: { message: 'email unavailable' },
        },
      ]);
      expect(serialized(logs)).not.toContain('user1@mail.example');
      expect(serialized(logs)).not.toContain('利用者1');
    });

    test('依頼待ちが無ければ宛先を引かず何もしない', async () => {
      const { sender, sent } = createRecordingSender();
      const directory = createContactDirectory();
      const notifier = notifierWith({ sender, contacts: directory.contacts });

      await notifier.sendPendingFor(STRIPE_SUBSCRIPTION_ID);

      expect(directory.lookedUp).toEqual([]);
      expect(sent).toEqual([]);
    });
  });
});

describe('noticePayloadOf', () => {
  test('受け付けた日時をISO 8601の瞬時で書き、特典の終了日時は無ければ省く', () => {
    expect(
      noticePayloadOf({ acceptedAt: ACCEPTED_AT, benefitEndsAt: null }),
    ).toEqual({ acceptedAt: '2026-11-05T10:15:30.000Z' });
    expect(
      noticePayloadOf({
        acceptedAt: ACCEPTED_AT,
        benefitEndsAt: BENEFIT_ENDS_AT,
      }),
    ).toEqual({
      acceptedAt: '2026-11-05T10:15:30.000Z',
      benefitEndsAt: '2026-12-01T15:00:00.000Z',
    });
  });
});
