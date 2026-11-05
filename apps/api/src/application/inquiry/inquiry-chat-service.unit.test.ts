import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { InquiryAttachmentBinder } from './inquiry-attachment-binder.ts';
import {
  type InquiryChatService,
  StoreInquiryChatService,
} from './inquiry-chat-service.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  InquiryMessageRecord,
  MemberInquiryPage,
  MemberInquiryRecord,
  MemberInquiryStore,
  NewInquiryMessage,
} from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const USER_ID = '01JD0000000000000000USER01';
const OTHER_USER_ID = '01JD0000000000000000USER02';
const INQUIRY_ID = '01JD0000000000000000MINQ01';
const NEW_MESSAGE_ID = '01JD0000000000000000MMSG02';
const FILE_A = '01JD0000000000000000FILE0A';
const FILE_B = '01JD0000000000000000FILE0B';

const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JD0000000000000000SESS01',
    }),
});

const userOf = (status: 'active' | 'suspended'): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JD0000000000000000PSEU01',
    status,
    emailVerifiedAt: new Date(0),
    deletedAt: null,
    email: 'member@mail.example',
    nickname: 'ログイン中の人',
    handle: 'member',
  },
});

const inquiryOf = (
  overrides: Partial<MemberInquiryRecord> = {},
): MemberInquiryRecord => ({
  id: INQUIRY_ID,
  userId: USER_ID,
  categoryId: '01JD0000000000000000000BUG',
  status: 'open',
  statusChangedAt: new Date('2027-03-01T00:00:00.000Z'),
  lastMessageAt: new Date('2027-03-02T00:00:00.000Z'),
  createdAt: new Date('2027-03-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const MESSAGES: readonly InquiryMessageRecord[] = Object.freeze([
  {
    id: '01JD0000000000000000MMSG01',
    inquiryId: INQUIRY_ID,
    sender: 'user',
    adminId: null,
    body: '画像のアップロードに失敗します。',
    fileIds: [FILE_A],
    createdAt: new Date('2027-03-01T00:00:00.000Z'),
  },
  {
    id: '01JD0000000000000000AMSG01',
    inquiryId: INQUIRY_ID,
    sender: 'admin',
    adminId: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
    body: '確認します。',
    fileIds: [],
    createdAt: new Date('2027-03-02T00:00:00.000Z'),
  },
]);

const PAGE: MemberInquiryPage = Object.freeze({
  items: [inquiryOf()],
  nextCursor: 'cursor-2',
});

const ACCOUNT_UNAVAILABLE = new AppError({
  kind: 'forbidden',
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
});

const UNAUTHENTICATED = new AppError({
  kind: 'unauthenticated',
  code: 'unauthenticated',
  message: 'ログインが必要です。',
});

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

interface AppendedMessage {
  readonly inquiryId: string;
  readonly message: NewInquiryMessage;
  readonly nextStatus: InquiryStatus;
}

interface FakeOptions {
  readonly currentUser?: CurrentUser;
  readonly userError?: AppError;
  readonly writableError?: AppError;
  readonly inquiry?: MemberInquiryRecord | undefined;
  readonly bindError?: AppError;
  readonly appendResult?: 'appended' | 'not-found';
  readonly appendError?: Error;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const bound: { readonly userId: string; readonly fileIds: string[] }[] = [];
  const released: (readonly string[])[] = [];
  const appended: AppendedMessage[] = [];
  const listed: {
    readonly userId: string;
    readonly page: { readonly after?: string; readonly limit: 20 };
  }[] = [];
  const auditCalls: string[] = [];
  const currentUser = options.currentUser ?? userOf('active');
  const inquiry = 'inquiry' in options ? options.inquiry : inquiryOf();
  const guard = partialFake<AccountGuard>({
    requireUser: () => {
      calls.push('requireUser');
      return options.userError === undefined
        ? Promise.resolve(currentUser)
        : Promise.reject(options.userError);
    },
    requireWritableUser: () => {
      calls.push('requireWritableUser');
      return options.writableError === undefined
        ? Promise.resolve(currentUser)
        : Promise.reject(options.writableError);
    },
  });
  const store = partialFake<MemberInquiryStore>({
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(inquiry?.id === id ? inquiry : undefined);
    },
    listMessages: (inquiryId) => {
      calls.push('listMessages');
      return Promise.resolve(inquiryId === INQUIRY_ID ? MESSAGES : []);
    },
    listByUser: (userId, page) => {
      calls.push('listByUser');
      listed.push({ userId, page });
      return Promise.resolve(PAGE);
    },
    appendUserMessage: (inquiryId, message, nextStatus) => {
      calls.push('appendUserMessage');
      appended.push({ inquiryId, message, nextStatus });
      return options.appendError === undefined
        ? Promise.resolve(options.appendResult ?? 'appended')
        : Promise.reject(options.appendError);
    },
  });
  const binder: InquiryAttachmentBinder = {
    bind: (userId, fileIds) => {
      calls.push('bind');
      bound.push({ userId, fileIds: [...fileIds] });
      return options.bindError === undefined
        ? Promise.resolve([...new Set(fileIds)])
        : Promise.reject(options.bindError);
    },
    release: (fileIds) => {
      calls.push('release');
      released.push(fileIds);
      return Promise.resolve();
    },
  };
  // 利用者の送信による自動のステータスの変更は管理操作ではないため、束縛しておいて呼ばれないことを確かめる
  const auditLog: AuditLogRecorder = {
    prepare: () => {
      auditCalls.push('prepare');
      return {} as PreparedAuditEntry;
    },
    record: () => {
      auditCalls.push('record');
      return Promise.resolve();
    },
  };
  const ids: IdGenerator = { generate: () => NEW_MESSAGE_ID };
  const container = new Container();
  container
    .bind<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
    .toConstantValue(guard);
  container
    .bind<MemberInquiryStore>(INQUIRY_TYPES.MemberInquiryStore)
    .toConstantValue(store);
  container
    .bind<InquiryAttachmentBinder>(INQUIRY_TYPES.InquiryAttachmentBinder)
    .toConstantValue(binder);
  container
    .bind<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    .toConstantValue(auditLog);
  container.bind<IdGenerator>(PLATFORM_TYPES.IdGenerator).toConstantValue(ids);
  container
    .bind<InquiryChatService>(INQUIRY_TYPES.InquiryChatService)
    .to(StoreInquiryChatService);
  const service = container.get<InquiryChatService>(
    INQUIRY_TYPES.InquiryChatService,
  );
  return { service, calls, bound, released, appended, listed, auditCalls };
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

const HIDDEN_INQUIRIES = [
  ['本人以外の問い合わせ', inquiryOf({ userId: OTHER_USER_ID })],
  ['存在しない問い合わせ', undefined],
  [
    '論理削除した問い合わせ',
    inquiryOf({ deletedAt: new Date('2027-03-10T00:00:00.000Z') }),
  ],
] as const;

describe('StoreInquiryChatService.view', () => {
  test('停止していない本人には、問い合わせとメッセージを送信の可否が真で返す', async () => {
    const { service, calls } = setup();

    const view = await service.view(SESSION, INQUIRY_ID);

    expect(view).toEqual({
      inquiry: inquiryOf(),
      messages: MESSAGES,
      canPost: true,
    });
    expect(calls).toEqual(['requireUser', 'findById', 'listMessages']);
  });

  test('停止中の本人も閲覧でき、送信の可否が偽になる', async () => {
    const { service, calls } = setup({ currentUser: userOf('suspended') });

    const view = await service.view(SESSION, INQUIRY_ID);

    expect(view).toEqual({
      inquiry: inquiryOf(),
      messages: MESSAGES,
      canPost: false,
    });
    expect(calls).toEqual(['requireUser', 'findById', 'listMessages']);
  });

  test.each(HIDDEN_INQUIRIES)(
    '%sは見つからない扱いにし、メッセージを読まない',
    async (_label, inquiry) => {
      const { service, calls } = setup({ inquiry });

      const view = await service.view(SESSION, INQUIRY_ID);

      expect(view).toBeUndefined();
      expect(calls).toEqual(['requireUser', 'findById']);
    },
  );

  test('ログインしていない要求は、問い合わせを読まずに拒否する', async () => {
    const { service, calls } = setup({ userError: UNAUTHENTICATED });

    const error = await caught(service.view(SESSION, INQUIRY_ID));

    expect(error).toBe(UNAUTHENTICATED);
    expect(calls).toEqual(['requireUser']);
  });
});

describe('StoreInquiryChatService.post', () => {
  const INPUT = Object.freeze({
    body: '  追加の情報です。\n再現の手順を書きます。  ',
    fileIds: [FILE_A, FILE_B, FILE_A],
  });

  test('本人の問い合わせへ、前後の空白を残した本文と紐付けた添付を保存し、保存したメッセージを返す', async () => {
    const { service, calls, bound, appended, released } = setup();

    const message = await service.post(SESSION, INQUIRY_ID, INPUT, NOW);

    const body = INPUT.body;
    expect(message).toEqual({
      id: NEW_MESSAGE_ID,
      inquiryId: INQUIRY_ID,
      sender: 'user',
      adminId: null,
      body,
      fileIds: [FILE_A, FILE_B],
      createdAt: NOW,
    });
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'appendUserMessage',
    ]);
    expect(bound).toEqual([{ userId: USER_ID, fileIds: [...INPUT.fileIds] }]);
    expect(appended).toEqual([
      {
        inquiryId: INQUIRY_ID,
        message: {
          id: NEW_MESSAGE_ID,
          body,
          fileIds: [FILE_A, FILE_B],
          at: NOW,
        },
        nextStatus: 'open',
      },
    ]);
    expect(released).toEqual([]);
  });

  test.each([
    ['open', 'open'],
    ['in_progress', 'in_progress'],
    ['resolved', 'open'],
    ['rejected', 'open'],
  ] as const)(
    'ステータスが%sの問い合わせへの送信は、%sを保存後のステータスとして渡し、監査ログの準備を呼ばない',
    async (status, nextStatus) => {
      const { service, appended, auditCalls } = setup({
        inquiry: inquiryOf({ status }),
      });

      await service.post(SESSION, INQUIRY_ID, INPUT, NOW);

      expect(appended.map((entry) => entry.nextStatus)).toEqual([nextStatus]);
      expect(auditCalls).toEqual([]);
    },
  );

  test('停止中の利用者の送信を、問い合わせの確認・添付の紐付け・保存の前に拒否する', async () => {
    const { service, calls, bound, appended } = setup({
      writableError: ACCOUNT_UNAVAILABLE,
    });

    const error = await caught(service.post(SESSION, INQUIRY_ID, INPUT, NOW));

    expect(error).toBe(ACCOUNT_UNAVAILABLE);
    expect(calls).toEqual(['requireWritableUser']);
    expect(bound).toEqual([]);
    expect(appended).toEqual([]);
  });

  test.each(HIDDEN_INQUIRIES)(
    '%sへの送信を、存在を明かさない見つからないエラーで拒否し、添付を紐付けない',
    async (_label, inquiry) => {
      const { service, calls, bound, appended } = setup({ inquiry });

      const error = await caught(service.post(SESSION, INQUIRY_ID, INPUT, NOW));

      expect(appErrorOf(error)).toEqual({
        kind: 'not_found',
        code: 'inquiry_not_found',
        details: undefined,
      });
      expect(calls).toEqual(['requireWritableUser', 'findById']);
      expect(bound).toEqual([]);
      expect(appended).toEqual([]);
    },
  );

  test.each([
    ['使用できない文字を含む本文', 'forbidden-character', '確認\u0000です。'],
    ['前後の空白だけの本文', 'empty', ' \n\t '],
    ['1,001書記素の本文', 'too-long', 'あ'.repeat(1_001)],
  ] as const)(
    '%sを、本文の欄の理由を持つ検証のエラーで拒否し、添付を紐付けない',
    async (_label, code, body) => {
      const { service, calls, bound, appended } = setup();

      const error = await caught(
        service.post(SESSION, INQUIRY_ID, { body, fileIds: [FILE_A] }, NOW),
      );

      const { details, ...rest } = appErrorOf(error);
      expect(rest).toEqual({ kind: 'bad_request', code: 'validation_error' });
      expect(details?.map((detail) => [detail.field, detail.code])).toEqual([
        ['body', code],
      ]);
      expect(calls).toEqual(['requireWritableUser', 'findById']);
      expect(bound).toEqual([]);
      expect(appended).toEqual([]);
    },
  );

  test('1,000書記素の本文と0件の添付を受け付ける', async () => {
    const body = 'あ'.repeat(1_000);
    const { service, appended } = setup();

    await service.post(SESSION, INQUIRY_ID, { body, fileIds: [] }, NOW);

    expect(appended.map((entry) => entry.message)).toEqual([
      { id: NEW_MESSAGE_ID, body, fileIds: [], at: NOW },
    ]);
  });

  test('前後の空白を含めると1,000書記素を超えても、除いた後が1,000書記素なら受け付けて元の値で保存する', async () => {
    const body = `\n  ${'あ'.repeat(1_000)}  \n`;
    const { service, appended } = setup();

    const message = await service.post(
      SESSION,
      INQUIRY_ID,
      { body, fileIds: [] },
      NOW,
    );

    expect(message.body).toBe(body);
    expect(appended.map((entry) => entry.message)).toEqual([
      { id: NEW_MESSAGE_ID, body, fileIds: [], at: NOW },
    ]);
  });

  test('添付の検証の違反はそのまま伝え、保存も解放もしない', async () => {
    const invalid = new AppError({
      kind: 'bad_request',
      code: 'inquiry_attachments_invalid',
      message: 'ファイルは20個以内で選択してください。',
    });
    const { service, calls, appended, released } = setup({
      bindError: invalid,
    });

    const error = await caught(service.post(SESSION, INQUIRY_ID, INPUT, NOW));

    expect(error).toBe(invalid);
    expect(calls).toEqual(['requireWritableUser', 'findById', 'bind']);
    expect(appended).toEqual([]);
    expect(released).toEqual([]);
  });

  test('保存に失敗したら紐付けたIDだけを解放し、保存の失敗をそのまま伝える', async () => {
    const failure = new Error('D1の一括の書き込みに失敗しました。');
    const { service, calls, released } = setup({ appendError: failure });

    const error = await caught(service.post(SESSION, INQUIRY_ID, INPUT, NOW));

    expect(error).toBe(failure);
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'appendUserMessage',
      'release',
    ]);
    expect(released).toEqual([[FILE_A, FILE_B]]);
  });

  test('確認の後に問い合わせが論理削除されて保存できなければ、紐付けたIDを解放して見つからないエラーにする', async () => {
    const { service, calls, released } = setup({ appendResult: 'not-found' });

    const error = await caught(service.post(SESSION, INQUIRY_ID, INPUT, NOW));

    expect(appErrorOf(error)).toEqual({
      kind: 'not_found',
      code: 'inquiry_not_found',
      details: undefined,
    });
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'appendUserMessage',
      'release',
    ]);
    expect(released).toEqual([[FILE_A, FILE_B]]);
  });
});

describe('StoreInquiryChatService.listMine', () => {
  test('本人の問い合わせを20件ずつ読み、最初のページは位置を渡さない', async () => {
    const { service, calls, listed } = setup();

    const page = await service.listMine(SESSION, undefined);

    expect(page).toEqual(PAGE);
    expect(calls).toEqual(['requireUser', 'listByUser']);
    expect(listed).toEqual([{ userId: USER_ID, page: { limit: 20 } }]);
  });

  test('続きのページは受け取った位置から20件を読む', async () => {
    const { service, listed } = setup();

    await service.listMine(SESSION, 'cursor-2');

    expect(listed).toEqual([
      { userId: USER_ID, page: { after: 'cursor-2', limit: 20 } },
    ]);
  });

  test('停止中の利用者も自分の一覧を読める', async () => {
    const { service, calls, listed } = setup({
      currentUser: userOf('suspended'),
    });

    const page = await service.listMine(SESSION, undefined);

    expect(page).toEqual(PAGE);
    expect(calls).toEqual(['requireUser', 'listByUser']);
    expect(listed).toEqual([{ userId: USER_ID, page: { limit: 20 } }]);
  });

  test('ログインしていない要求は、一覧を読まずに拒否する', async () => {
    const { service, calls } = setup({ userError: UNAUTHENTICATED });

    const error = await caught(service.listMine(SESSION, undefined));

    expect(error).toBe(UNAUTHENTICATED);
    expect(calls).toEqual(['requireUser']);
  });
});
