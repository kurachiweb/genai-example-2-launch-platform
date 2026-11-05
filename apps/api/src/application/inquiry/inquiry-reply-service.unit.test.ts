import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../lib/core/identity/ports.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type InquiryReplyService,
  StoreInquiryReplyService,
} from './inquiry-reply-service.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  AdminInquiryDetail,
  GuestInquiryRecord,
  InquiryAdminReader,
  InquiryIncidentKind,
  InquiryIncidentReporter,
  InquiryMailer,
  InquiryReplyNotification,
  MemberInquiryRecord,
  MemberInquiryStore,
  NewAdminReply,
} from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const USER_ID = '01JD0000000000000000USER01';
const INQUIRY_ID = '01JD0000000000000000MINQ01';
const GUEST_INQUIRY_ID = '01JD0000000000000000GINQ01';
const REPLY_ID = '01JD0000000000000000AMSG02';

const CURRENT_ADMIN: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: 'モデレーター',
  sessionId: '01JD0000000000000000SESS09',
});

const memberInquiryOf = (
  overrides: Partial<MemberInquiryRecord> = {},
): MemberInquiryRecord => ({
  id: INQUIRY_ID,
  userId: USER_ID,
  categoryId: '01JD0000000000000000000BUG',
  status: 'resolved',
  statusChangedAt: new Date('2027-03-02T00:00:00.000Z'),
  lastMessageAt: new Date('2027-03-03T00:00:00.000Z'),
  createdAt: new Date('2027-03-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const GUEST_INQUIRY: GuestInquiryRecord = Object.freeze({
  id: GUEST_INQUIRY_ID,
  categoryId: '01JC0000000000000000000000',
  nickname: '未ログインの人',
  email: 'guest@mail.example',
  body: 'ログインできません。',
  status: 'open',
  statusChangedAt: new Date('2027-03-05T00:00:00.000Z'),
  createdAt: new Date('2027-03-05T00:00:00.000Z'),
});

const contactOf = (overrides: Partial<UserContact> = {}): UserContact => ({
  userId: USER_ID,
  email: 'member@mail.example',
  nickname: 'ログイン中の人',
  emailVerified: true,
  ...overrides,
});

const PREPARED = Object.freeze({
  operatorAdminId: CURRENT_ADMIN.id,
}) as unknown as PreparedAuditEntry;

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      // コンテナは注入する値がPromiseかをthenの有無で調べるため、thenは無いものとして返す
      if (property === 'then' || typeof property === 'symbol') {
        return undefined;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${property}`);
      };
    },
  }) as T;
}

interface AppendedReply {
  readonly inquiryId: string;
  readonly reply: NewAdminReply;
  readonly audit: PreparedAuditEntry;
}

interface Reported {
  readonly kind: InquiryIncidentKind;
  readonly error: unknown;
  readonly attributes: { readonly inquiryId?: string };
}

interface FakeOptions {
  readonly detail?: AdminInquiryDetail | undefined;
  readonly prepareError?: AppError;
  readonly appendResult?: 'appended' | 'not-found' | 'withdrawn';
  readonly contact?: UserContact | undefined;
  readonly contactError?: Error;
  readonly mailError?: Error;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const appended: AppendedReply[] = [];
  const contactRequests: string[] = [];
  const sent: InquiryReplyNotification[] = [];
  const reported: Reported[] = [];
  const detail =
    'detail' in options
      ? options.detail
      : { kind: 'member' as const, inquiry: memberInquiryOf() };
  const contact = 'contact' in options ? options.contact : contactOf();
  const reader = partialFake<InquiryAdminReader>({
    findDetail: (id) => {
      calls.push('findDetail');
      return Promise.resolve(detail?.inquiry.id === id ? detail : undefined);
    },
  });
  const store = partialFake<MemberInquiryStore>({
    appendAdminReply: (inquiryId, reply, audit) => {
      calls.push('appendAdminReply');
      appended.push({ inquiryId, reply, audit });
      return Promise.resolve(options.appendResult ?? 'appended');
    },
  });
  const auditLog = partialFake<AuditLogRecorder>({
    prepare: (input) => {
      calls.push('prepare');
      prepared.push(input);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
      return PREPARED;
    },
  });
  const contacts: UserContactDirectory = {
    findContact: (userId) => {
      calls.push('findContact');
      contactRequests.push(userId);
      return options.contactError === undefined
        ? Promise.resolve(contact)
        : Promise.reject(options.contactError);
    },
  };
  const mailer: InquiryMailer = {
    sendReplyNotification: (input) => {
      calls.push('sendReplyNotification');
      sent.push(input);
      return options.mailError === undefined
        ? Promise.resolve()
        : Promise.reject(options.mailError);
    },
  };
  const incidents: InquiryIncidentReporter = {
    report: (kind, error, attributes) => {
      calls.push('report');
      reported.push({ kind, error, attributes });
    },
  };
  const ids: IdGenerator = { generate: () => REPLY_ID };
  const clock: Clock = { now: () => NOW };
  const container = new Container();
  container
    .bind<InquiryAdminReader>(INQUIRY_TYPES.InquiryAdminReader)
    .toConstantValue(reader);
  container
    .bind<MemberInquiryStore>(INQUIRY_TYPES.MemberInquiryStore)
    .toConstantValue(store);
  container
    .bind<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    .toConstantValue(auditLog);
  container
    .bind<UserContactDirectory>(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    .toConstantValue(contacts);
  container
    .bind<InquiryMailer>(INQUIRY_TYPES.InquiryMailer)
    .toConstantValue(mailer);
  container
    .bind<InquiryIncidentReporter>(INQUIRY_TYPES.InquiryIncidentReporter)
    .toConstantValue(incidents);
  container.bind<IdGenerator>(PLATFORM_TYPES.IdGenerator).toConstantValue(ids);
  container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);
  container
    .bind<InquiryReplyService>(INQUIRY_TYPES.InquiryReplyService)
    .to(StoreInquiryReplyService);
  const service = container.get<InquiryReplyService>(
    INQUIRY_TYPES.InquiryReplyService,
  );
  return {
    service,
    calls,
    prepared,
    appended,
    contactRequests,
    sent,
    reported,
  };
}

async function caught(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const appErrorOf = (error: unknown) => {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  return {
    kind: appError.kind,
    code: appError.code,
    details: appError.details,
  };
};

const INPUT = Object.freeze({
  inquiryId: INQUIRY_ID,
  body: '  ご連絡ありがとうございます。\n確認しました。  ',
  reason: '利用者への回答',
});

describe('StoreInquiryReplyService.reply', () => {
  test('返信を監査ログの準備の後に前後の空白を残した本文で保存し、利用者へ通知を送って返信と通知の可否を返す', async () => {
    const { service, calls, prepared, appended, contactRequests, sent } =
      setup();

    const result = await service.reply(CURRENT_ADMIN, INPUT);

    expect(result).toEqual({
      message: {
        id: REPLY_ID,
        inquiryId: INQUIRY_ID,
        sender: 'admin',
        adminId: CURRENT_ADMIN.id,
        body: INPUT.body,
        fileIds: [],
        createdAt: NOW,
      },
      notificationQueued: true,
    });
    expect(calls).toEqual([
      'findDetail',
      'prepare',
      'appendAdminReply',
      'findContact',
      'sendReplyNotification',
    ]);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT_ADMIN.id,
        action: 'inquiry.reply',
        targetIds: [INQUIRY_ID],
        reason: INPUT.reason,
        occurredAt: NOW,
      },
    ]);
    expect(appended).toEqual([
      {
        inquiryId: INQUIRY_ID,
        reply: {
          id: REPLY_ID,
          adminId: CURRENT_ADMIN.id,
          body: INPUT.body,
          at: NOW,
        },
        audit: PREPARED,
      },
    ]);
    expect(contactRequests).toEqual([USER_ID]);
    expect(sent).toEqual([
      {
        to: 'member@mail.example',
        nickname: 'ログイン中の人',
        inquiryId: INQUIRY_ID,
        repliedAt: NOW,
      },
    ]);
  });

  test('理由を省いた返信は、理由の無い監査ログを準備する', async () => {
    const { service, prepared } = setup();

    await service.reply(CURRENT_ADMIN, {
      inquiryId: INQUIRY_ID,
      body: '確認しました。',
    });

    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT_ADMIN.id,
        action: 'inquiry.reply',
        targetIds: [INQUIRY_ID],
        occurredAt: NOW,
      },
    ]);
  });

  test.each(['open', 'in_progress', 'resolved', 'rejected'] as const)(
    'ステータスが%sの問い合わせへの返信は、ステータスの変更をストアへ渡さない',
    async (status) => {
      const { service, appended } = setup({
        detail: { kind: 'member', inquiry: memberInquiryOf({ status }) },
      });

      await service.reply(CURRENT_ADMIN, INPUT);

      expect(appended.map((entry) => Object.keys(entry.reply))).toEqual([
        ['id', 'adminId', 'body', 'at'],
      ]);
    },
  );

  test('未ログインの問い合わせへの返信を、監査ログの準備と保存の前に拒否する', async () => {
    const { service, calls } = setup({
      detail: { kind: 'guest', inquiry: GUEST_INQUIRY },
    });

    const error = await caught(
      service.reply(CURRENT_ADMIN, { ...INPUT, inquiryId: GUEST_INQUIRY_ID }),
    );

    expect(appErrorOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_not_repliable',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test('退会済み(論理削除した)の問い合わせへの返信を、監査ログの準備と保存の前に拒否する', async () => {
    const { service, calls } = setup({
      detail: {
        kind: 'member',
        inquiry: memberInquiryOf({
          deletedAt: new Date('2027-03-10T00:00:00.000Z'),
        }),
      },
    });

    const error = await caught(service.reply(CURRENT_ADMIN, INPUT));

    expect(appErrorOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_read_only',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test('存在しない問い合わせへの返信を、見つからないエラーで拒否する', async () => {
    const { service, calls } = setup({ detail: undefined });

    const error = await caught(service.reply(CURRENT_ADMIN, INPUT));

    expect(appErrorOf(error)).toEqual({
      kind: 'not_found',
      code: 'inquiry_not_found',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test.each([
    ['使用できない文字を含む本文', 'forbidden-character', '確認\u0000です。'],
    ['前後の空白だけの本文', 'empty', ' \n\t '],
    ['1,001書記素の本文', 'too-long', 'あ'.repeat(1_001)],
  ] as const)(
    '%sを、本文の欄の理由を持つ検証のエラーで問い合わせを読む前に拒否する',
    async (_label, code, body) => {
      const { service, calls } = setup();

      const error = await caught(
        service.reply(CURRENT_ADMIN, { inquiryId: INQUIRY_ID, body }),
      );

      const { details, ...rest } = appErrorOf(error);
      expect(rest).toEqual({ kind: 'bad_request', code: 'validation_error' });
      expect(details?.map((detail) => [detail.field, detail.code])).toEqual([
        ['body', code],
      ]);
      expect(calls).toEqual([]);
    },
  );

  test('前後の空白を除いて1,000書記素の本文を受け付けて元の値で保存する', async () => {
    const body = `\n ${'あ'.repeat(1_000)} \n`;
    const { service, appended } = setup();

    const result = await service.reply(CURRENT_ADMIN, {
      inquiryId: INQUIRY_ID,
      body,
    });

    expect(result.message.body).toBe(body);
    expect(appended.map((entry) => entry.reply.body)).toEqual([body]);
  });

  test('監査ログの準備の違反は、返信を保存せずにそのまま伝える', async () => {
    const invalid = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
    });
    const { service, calls } = setup({ prepareError: invalid });

    const error = await caught(service.reply(CURRENT_ADMIN, INPUT));

    expect(error).toBe(invalid);
    expect(calls).toEqual(['findDetail', 'prepare']);
  });

  test('確認の後に退会が確定して保存が取り消されたら、退会済みのエラーにして通知を送らない', async () => {
    const { service, calls } = setup({ appendResult: 'withdrawn' });

    const error = await caught(service.reply(CURRENT_ADMIN, INPUT));

    expect(appErrorOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_read_only',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail', 'prepare', 'appendAdminReply']);
  });

  test('確認の後に問い合わせが消えて保存できなければ、見つからないエラーにして通知を送らない', async () => {
    const { service, calls } = setup({ appendResult: 'not-found' });

    const error = await caught(service.reply(CURRENT_ADMIN, INPUT));

    expect(appErrorOf(error)).toEqual({
      kind: 'not_found',
      code: 'inquiry_not_found',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail', 'prepare', 'appendAdminReply']);
  });

  test('メールアドレスが未確認の利用者にも通知を送る', async () => {
    const { service, sent } = setup({
      contact: contactOf({ emailVerified: false }),
    });

    const result = await service.reply(CURRENT_ADMIN, INPUT);

    expect(result.notificationQueued).toBe(true);
    expect(sent.map((notification) => notification.to)).toEqual([
      'member@mail.example',
    ]);
  });

  test('照会口が利用者を返さなければ、返信を保存したまま通知を送らずに通知の可否を偽で返し、報告しない', async () => {
    const { service, calls, appended, reported } = setup({
      contact: undefined,
    });

    const result = await service.reply(CURRENT_ADMIN, INPUT);

    expect(result.notificationQueued).toBe(false);
    expect(result.message.id).toBe(REPLY_ID);
    expect(appended).toHaveLength(1);
    expect(calls).toEqual([
      'findDetail',
      'prepare',
      'appendAdminReply',
      'findContact',
    ]);
    expect(reported).toEqual([]);
  });

  test('通知メールの送信要求に失敗したら、返信を保存したまま通知の可否を偽で返し、問い合わせのIDを付けて報告する', async () => {
    const failure = new Error('メールの送信の要求に失敗しました。');
    const { service, calls, appended, reported } = setup({
      mailError: failure,
    });

    const result = await service.reply(CURRENT_ADMIN, INPUT);

    expect(result.notificationQueued).toBe(false);
    expect(result.message.id).toBe(REPLY_ID);
    expect(appended).toHaveLength(1);
    expect(calls).toEqual([
      'findDetail',
      'prepare',
      'appendAdminReply',
      'findContact',
      'sendReplyNotification',
      'report',
    ]);
    expect(reported).toEqual([
      {
        kind: 'reply-notification-failed',
        error: failure,
        attributes: { inquiryId: INQUIRY_ID },
      },
    ]);
  });

  test('通知先の照会に失敗しても、返信を保存したまま通知の可否を偽で返して報告する', async () => {
    const failure = new Error('D1の読み取りに失敗しました。');
    const { service, calls, reported } = setup({ contactError: failure });

    const result = await service.reply(CURRENT_ADMIN, INPUT);

    expect(result.notificationQueued).toBe(false);
    expect(calls).toEqual([
      'findDetail',
      'prepare',
      'appendAdminReply',
      'findContact',
      'report',
    ]);
    expect(reported).toEqual([
      {
        kind: 'reply-notification-failed',
        error: failure,
        attributes: { inquiryId: INQUIRY_ID },
      },
    ]);
  });
});
