import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

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
import type { InquiryRequestMeta } from './inquiry-request-meta.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import {
  type MemberInquiryInput,
  type MemberInquirySubmission,
  StoreMemberInquirySubmission,
} from './member-inquiry-submission.ts';
import type {
  InquiryCategoryRecord,
  InquiryCategoryStore,
  MemberInquiryStore,
  NewMemberInquiry,
} from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const NEW_INQUIRY_ID = '01JD0000000000000000MINQ01';
const NEW_MESSAGE_ID = '01JD0000000000000000MMSG01';
const USER_ID = '01JD0000000000000000USER01';
const CATEGORY_ID = '01JD0000000000000000000BUG';
const FILE_A = '01JD0000000000000000FILE0A';
const FILE_B = '01JD0000000000000000FILE0B';

const CATEGORY: InquiryCategoryRecord = Object.freeze({
  id: CATEGORY_ID,
  name: '不具合の報告',
  systemDefault: false,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
});

const INPUT: MemberInquiryInput = Object.freeze({
  categoryId: CATEGORY_ID,
  body: '画像のアップロードに失敗します。',
  fileIds: [FILE_A, FILE_B, FILE_A],
});

const META: InquiryRequestMeta = Object.freeze({
  clientIp: '192.0.2.10',
  now: NOW,
});

const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JD0000000000000000SESS01',
    }),
});

const userOf = (emailVerifiedAt: Date | null): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JD0000000000000000PSEU01',
    status: 'active',
    emailVerifiedAt,
    deletedAt: null,
    email: 'member@mail.example',
    nickname: 'ログイン中の人',
    handle: 'member',
  },
});

const ACCOUNT_UNAVAILABLE = new AppError({
  kind: 'forbidden',
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
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

interface FakeOptions {
  readonly writableError?: AppError;
  readonly currentUser?: CurrentUser;
  readonly categories?: readonly InquiryCategoryRecord[];
  readonly bindError?: AppError;
  readonly insertError?: Error;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const bound: { readonly userId: string; readonly fileIds: string[] }[] = [];
  const released: (readonly string[])[] = [];
  const inserted: NewMemberInquiry[] = [];
  const categories = options.categories ?? [CATEGORY];
  const currentUser = options.currentUser ?? userOf(new Date(0));
  const guard = partialFake<AccountGuard>({
    requireWritableUser: () => {
      calls.push('requireWritableUser');
      return options.writableError === undefined
        ? Promise.resolve(currentUser)
        : Promise.reject(options.writableError);
    },
  });
  const categoryStore = partialFake<InquiryCategoryStore>({
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(categories.find((category) => category.id === id));
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
  const memberStore = partialFake<MemberInquiryStore>({
    insert: (inquiry) => {
      calls.push('insert');
      inserted.push(inquiry);
      return options.insertError === undefined
        ? Promise.resolve()
        : Promise.reject(options.insertError);
    },
  });
  const generated = [NEW_INQUIRY_ID, NEW_MESSAGE_ID];
  const ids: IdGenerator = {
    generate: () => {
      const id = generated.shift();
      if (id === undefined) {
        throw new Error('用意したIDを使い切りました。');
      }
      return id;
    },
  };
  const container = new Container();
  container
    .bind<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
    .toConstantValue(guard);
  container
    .bind<InquiryCategoryStore>(INQUIRY_TYPES.InquiryCategoryStore)
    .toConstantValue(categoryStore);
  container
    .bind<InquiryAttachmentBinder>(INQUIRY_TYPES.InquiryAttachmentBinder)
    .toConstantValue(binder);
  container
    .bind<MemberInquiryStore>(INQUIRY_TYPES.MemberInquiryStore)
    .toConstantValue(memberStore);
  container.bind<IdGenerator>(PLATFORM_TYPES.IdGenerator).toConstantValue(ids);
  container
    .bind<MemberInquirySubmission>(INQUIRY_TYPES.MemberInquirySubmission)
    .to(StoreMemberInquirySubmission);
  const submission = container.get<MemberInquirySubmission>(
    INQUIRY_TYPES.MemberInquirySubmission,
  );
  return { submission, calls, bound, released, inserted };
}

async function caught(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('StoreMemberInquirySubmission', () => {
  test('書き込みできる利用者の確認・カテゴリの確認・添付の紐付けの後に、問い合わせと最初のメッセージを保存してIDを返す', async () => {
    const { submission, calls, bound, inserted, released } = setup();

    const result = await submission.submit(SESSION, INPUT, META);

    expect(result).toEqual({ inquiryId: NEW_INQUIRY_ID });
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'insert',
    ]);
    expect(bound).toEqual([{ userId: USER_ID, fileIds: [...INPUT.fileIds] }]);
    expect(inserted).toEqual([
      {
        id: NEW_INQUIRY_ID,
        userId: USER_ID,
        categoryId: CATEGORY_ID,
        at: NOW,
        firstMessage: {
          id: NEW_MESSAGE_ID,
          body: INPUT.body,
          fileIds: [FILE_A, FILE_B],
          at: NOW,
        },
      },
    ]);
    expect(released).toEqual([]);
  });

  test('添付が0件でも問い合わせを保存する', async () => {
    const { submission, inserted } = setup();

    const result = await submission.submit(
      SESSION,
      { ...INPUT, fileIds: [] },
      META,
    );

    expect(result).toEqual({ inquiryId: NEW_INQUIRY_ID });
    expect(inserted.map((inquiry) => inquiry.firstMessage.fileIds)).toEqual([
      [],
    ]);
  });

  test('メールアドレスが未確認の利用者の送信も受け付ける', async () => {
    const { submission, calls, inserted } = setup({
      currentUser: userOf(null),
    });

    const result = await submission.submit(SESSION, INPUT, META);

    expect(result).toEqual({ inquiryId: NEW_INQUIRY_ID });
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'insert',
    ]);
    expect(inserted.map((inquiry) => inquiry.userId)).toEqual([USER_ID]);
  });

  test('停止中の利用者の送信を、カテゴリの確認・添付の紐付け・保存の前に拒否する', async () => {
    const { submission, calls, bound, inserted } = setup({
      writableError: ACCOUNT_UNAVAILABLE,
    });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect(error).toBe(ACCOUNT_UNAVAILABLE);
    expect(calls).toEqual(['requireWritableUser']);
    expect(bound).toEqual([]);
    expect(inserted).toEqual([]);
  });

  test('存在しないカテゴリの送信を、カテゴリの欄の詳細を持つ検証のエラーで拒否し、添付を紐付けない', async () => {
    const { submission, calls, bound, inserted } = setup({ categories: [] });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect({
      kind: appError.kind,
      code: appError.code,
      details: appError.details,
    }).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      details: [
        {
          field: 'categoryId',
          code: 'not-found',
          message: 'カテゴリを選択してください。',
        },
      ],
    });
    expect(calls).toEqual(['requireWritableUser', 'findById']);
    expect(bound).toEqual([]);
    expect(inserted).toEqual([]);
  });

  test('添付の検証の違反はそのまま伝え、保存も解放もしない', async () => {
    const invalid = new AppError({
      kind: 'bad_request',
      code: 'inquiry_attachments_invalid',
      message: 'ファイルは20個以内で選択してください。',
    });
    const { submission, calls, inserted, released } = setup({
      bindError: invalid,
    });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect(error).toBe(invalid);
    expect(calls).toEqual(['requireWritableUser', 'findById', 'bind']);
    expect(inserted).toEqual([]);
    expect(released).toEqual([]);
  });

  test('保存に失敗したら紐付けたIDだけを解放し、保存の失敗をそのまま伝える', async () => {
    const failure = new Error('D1の一括の書き込みに失敗しました。');
    const { submission, calls, released } = setup({ insertError: failure });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect(error).toBe(failure);
    expect(calls).toEqual([
      'requireWritableUser',
      'findById',
      'bind',
      'insert',
      'release',
    ]);
    expect(released).toEqual([[FILE_A, FILE_B]]);
  });
});
