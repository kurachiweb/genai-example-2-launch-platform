import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import {
  type GuestInquiryInput,
  type GuestInquirySubmission,
  StoreGuestInquirySubmission,
} from './guest-inquiry-submission.ts';
import type { InquiryRequestMeta } from './inquiry-request-meta.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  GuestInquiryRateLimit,
  GuestInquiryStore,
  InquiryCategoryRecord,
  InquiryCategoryStore,
  InquiryMailer,
  InquiryReplyNotification,
  NewGuestInquiry,
} from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const NEW_INQUIRY_ID = '01JD0000000000000000GINQ01';
const USER_ID = '01JD0000000000000000USER01';
const CATEGORY_ID = '01JD0000000000000000000BUG';
const CLIENT_IP = '192.0.2.10';

const CATEGORY: InquiryCategoryRecord = Object.freeze({
  id: CATEGORY_ID,
  name: '不具合の報告',
  systemDefault: false,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
});

const INPUT: GuestInquiryInput = Object.freeze({
  categoryId: CATEGORY_ID,
  nickname: '問い合わせる人',
  email: 'guest@mail.example',
  body: 'ログインできません。',
});

const META: InquiryRequestMeta = Object.freeze({
  clientIp: CLIENT_IP,
  now: NOW,
});

const SESSION: SessionView = Object.freeze({
  principal: () => Promise.resolve({ kind: 'anonymous' as const }),
});

const userOf = (status: UserAccountView['status']): CurrentUser => ({
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
    emailVerifiedAt: null,
    deletedAt: null,
    email: 'member@mail.example',
    nickname: 'ログイン中の人',
    handle: 'member',
  },
});

interface FakeOptions {
  readonly currentUser?: CurrentUser;
  readonly categories?: readonly InquiryCategoryRecord[];
  readonly rateLimitError?: AppError;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const inserted: NewGuestInquiry[] = [];
  const consumed: {
    readonly clientIp: string | undefined;
    readonly now: Date;
  }[] = [];
  const mailed: InquiryReplyNotification[] = [];
  const categories = options.categories ?? [CATEGORY];
  const guard: AccountGuard = {
    currentUser: () => {
      calls.push('currentUser');
      return Promise.resolve(options.currentUser);
    },
    requireUser: () => Promise.reject(new Error('呼ばれない想定です')),
    requireWritableUser: () => Promise.reject(new Error('呼ばれない想定です')),
    requireVerifiedUser: () => Promise.reject(new Error('呼ばれない想定です')),
  };
  const categoryStore: InquiryCategoryStore = {
    list: () => Promise.reject(new Error('呼ばれない想定です')),
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(categories.find((category) => category.id === id));
    },
    insert: () => Promise.reject(new Error('呼ばれない想定です')),
    rename: () => Promise.reject(new Error('呼ばれない想定です')),
    deleteAndReassign: () => Promise.reject(new Error('呼ばれない想定です')),
    countLinked: () => Promise.reject(new Error('呼ばれない想定です')),
    countLinkedByCategory: () =>
      Promise.reject(new Error('呼ばれない想定です')),
  };
  const rateLimit: GuestInquiryRateLimit = {
    consume: (clientIp, now) => {
      calls.push('consume');
      consumed.push({ clientIp, now });
      return options.rateLimitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.rateLimitError);
    },
  };
  const guestStore: GuestInquiryStore = {
    insert: (inquiry) => {
      calls.push('insert');
      inserted.push(inquiry);
      return Promise.resolve();
    },
    deleteClosedBefore: () => Promise.reject(new Error('呼ばれない想定です')),
  };
  const mailer: InquiryMailer = {
    sendReplyNotification: (notification) => {
      mailed.push(notification);
      return Promise.resolve();
    },
  };
  const ids: IdGenerator = { generate: () => NEW_INQUIRY_ID };
  const container = new Container();
  container
    .bind<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
    .toConstantValue(guard);
  container
    .bind<InquiryCategoryStore>(INQUIRY_TYPES.InquiryCategoryStore)
    .toConstantValue(categoryStore);
  container
    .bind<GuestInquiryRateLimit>(INQUIRY_TYPES.GuestInquiryRateLimit)
    .toConstantValue(rateLimit);
  container
    .bind<GuestInquiryStore>(INQUIRY_TYPES.GuestInquiryStore)
    .toConstantValue(guestStore);
  container
    .bind<InquiryMailer>(INQUIRY_TYPES.InquiryMailer)
    .toConstantValue(mailer);
  container.bind<IdGenerator>(PLATFORM_TYPES.IdGenerator).toConstantValue(ids);
  container
    .bind<GuestInquirySubmission>(INQUIRY_TYPES.GuestInquirySubmission)
    .to(StoreGuestInquirySubmission);
  const submission = container.get<GuestInquirySubmission>(
    INQUIRY_TYPES.GuestInquirySubmission,
  );
  return { submission, calls, inserted, consumed, mailed };
}

async function caught(action: Promise<void>): Promise<AppError> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('StoreGuestInquirySubmission', () => {
  test('未ログインの送信を、利用者の判定・カテゴリの確認・回数制限の順に通してから保存する', async () => {
    const { submission, calls, inserted, consumed } = setup();

    await submission.submit(SESSION, INPUT, META);

    expect(calls).toEqual(['currentUser', 'findById', 'consume', 'insert']);
    expect(consumed).toEqual([{ clientIp: CLIENT_IP, now: NOW }]);
    expect(inserted).toEqual([
      {
        id: NEW_INQUIRY_ID,
        categoryId: CATEGORY_ID,
        nickname: INPUT.nickname,
        email: INPUT.email,
        body: INPUT.body,
        at: NOW,
      },
    ]);
  });

  test('停止中の利用者の送信も未ログインの問い合わせとして受け付け、保存に利用者のIDを入れない', async () => {
    const { submission, calls, inserted } = setup({
      currentUser: userOf('suspended'),
    });

    await submission.submit(SESSION, INPUT, META);

    expect(calls).toEqual(['currentUser', 'findById', 'consume', 'insert']);
    expect(inserted).toHaveLength(1);
    expect(Object.keys(inserted[0] ?? {}).sort()).toEqual(
      ['at', 'body', 'categoryId', 'email', 'id', 'nickname'].sort(),
    );
    const serialized = JSON.stringify(inserted);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain('member@mail.example');
  });

  test('停止していないログイン中の利用者の送信を、カテゴリの確認・回数制限・保存の前に拒否する', async () => {
    const { submission, calls, inserted, consumed } = setup({
      currentUser: userOf('active'),
    });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
    }).toEqual({
      kind: 'forbidden',
      code: 'member_inquiry_required',
      message:
        'ログイン中のため、このフォームは使えません。ページを再読み込みしてください。',
    });
    expect(calls).toEqual(['currentUser']);
    expect(consumed).toEqual([]);
    expect(inserted).toEqual([]);
  });

  test('存在しないカテゴリの送信を、カテゴリの欄の詳細を持つ検証のエラーで拒否し、回数に数えない', async () => {
    const { submission, calls, inserted, consumed } = setup({
      categories: [],
    });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect({
      kind: error.kind,
      code: error.code,
      details: error.details,
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
    expect(calls).toEqual(['currentUser', 'findById']);
    expect(consumed).toEqual([]);
    expect(inserted).toEqual([]);
  });

  test('回数制限の超過はそのまま伝え、保存しない', async () => {
    const limited = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 1200,
    });
    const { submission, calls, inserted } = setup({ rateLimitError: limited });

    const error = await caught(submission.submit(SESSION, INPUT, META));

    expect(error).toBe(limited);
    expect(calls).toEqual(['currentUser', 'findById', 'consume']);
    expect(inserted).toEqual([]);
  });

  test('送信元IPアドレスが不明でも、判定を回数制限に任せて渡す', async () => {
    const { submission, consumed, inserted } = setup();

    await submission.submit(SESSION, INPUT, { clientIp: undefined, now: NOW });

    expect(consumed).toEqual([{ clientIp: undefined, now: NOW }]);
    expect(inserted).toHaveLength(1);
  });

  test.each([
    ['未ログイン', undefined],
    ['停止中', userOf('suspended')],
  ] as const)(
    '%sの送信で受付確認や返信のメールを送らない',
    async (_label, currentUser) => {
      const { submission, mailed, inserted } = setup({
        ...(currentUser === undefined ? {} : { currentUser }),
      });

      await submission.submit(SESSION, INPUT, META);

      expect(inserted).toHaveLength(1);
      expect(mailed).toEqual([]);
    },
  );
});
