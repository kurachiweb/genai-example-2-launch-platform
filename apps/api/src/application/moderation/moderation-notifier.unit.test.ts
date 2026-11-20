import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import {
  MODERATION_COMMENT_HIDDEN_EMAIL,
  MODERATION_PRODUCT_HIDDEN_EMAIL,
  MODERATION_USER_SUSPENDED_EMAIL,
} from '../../../lib/core/email/kinds/ugc-moderation.ts';
import type {
  EmailSendRequest,
  EmailSender,
} from '../../../lib/core/email/ports.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../../lib/core/engagement/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../lib/core/identity/ports.ts';
import type {
  ModerationRecord,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  EmailModerationNotifier,
  type ModerationNotifier,
} from './moderation-notifier.ts';

const NOW = new Date('2026-11-20T05:00:00.000Z');
const OCCURRED_AT = new Date('2026-11-20T04:21:00.000Z');
const CLIENT_ORIGIN = 'https://client.example';
const ACTION_ID = '01JQ0MDR000000000000000001';
const USER_ID = '01JQ0USR000000000000000001';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const COMMENT_ID = '01JQ0CMT000000000000000001';
const COMMENT_AUTHOR_ID = '01JQ0USR000000000000000002';

const recordOf = (
  overrides: Partial<ModerationRecord> = {},
): ModerationRecord => ({
  id: ACTION_ID,
  action: 'user.suspend',
  targetId: USER_ID,
  subjectUserId: USER_ID,
  productId: null,
  operatorAdminId: '01JQ0ADM000000000000000001',
  reason: '規約違反の投稿を繰り返したため',
  lifecycleEventId: '01JQ0EVT000000000000000001',
  occurredAt: OCCURRED_AT,
  noticeStatus: 'pending',
  noticeRequestedAt: null,
  ...overrides,
});

const productHideRecord = (
  overrides: Partial<ModerationRecord> = {},
): ModerationRecord =>
  recordOf({
    action: 'product.hide',
    targetId: PRODUCT_ID,
    subjectUserId: USER_ID,
    productId: PRODUCT_ID,
    ...overrides,
  });

const commentHideRecord = (
  overrides: Partial<ModerationRecord> = {},
): ModerationRecord =>
  recordOf({
    action: 'comment.hide',
    targetId: COMMENT_ID,
    subjectUserId: COMMENT_AUTHOR_ID,
    productId: PRODUCT_ID,
    lifecycleEventId: null,
    ...overrides,
  });

const contactOf = (overrides: Partial<UserContact> = {}): UserContact => ({
  userId: USER_ID,
  email: 'suspended@mail.example',
  nickname: '停止された人',
  emailVerified: true,
  ...overrides,
});

const productOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: USER_ID,
  handle: 'hidden-product',
  name: '非公開化されたプロダクト',
  tagline: 'ひとこと',
  category: { id: '01JQ0CAT000000000000000001', name: '開発', handle: 'dev' },
  websiteUrl: 'https://product.example',
  logoFileId: '01JQ0FIL000000000000000001',
  hidden: true,
  visible: false,
  listed: false,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

const commentOf = (overrides: Partial<CommentRecord> = {}): CommentRecord => ({
  commentId: COMMENT_ID,
  productId: PRODUCT_ID,
  launchId: '01JQ0LCH000000000000000001',
  parentId: null,
  rootId: COMMENT_ID,
  depth: 1,
  authorUserId: COMMENT_AUTHOR_ID,
  bodyMarkdown: '不適切なコメントの本文',
  createdAt: new Date('2026-11-19T00:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  hiddenAt: OCCURRED_AT,
  anonymizedAt: null,
  ...overrides,
});

interface Scenario {
  readonly record?: ModerationRecord;
  readonly contacts?: readonly UserContact[];
  readonly products?: readonly ProductSummaryRecord[];
  readonly comments?: readonly CommentRecord[];
  readonly sendError?: Error;
  readonly markError?: Error;
  readonly markResult?: boolean;
}

interface Harness {
  readonly notifier: ModerationNotifier;
  readonly calls: string[];
  readonly sent: EmailSendRequest<unknown>[];
  readonly marks: Parameters<ModerationRecordStore['markNotice']>[0][];
  readonly contactLookups: string[];
  readonly productLookups: {
    readonly ids: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
  readonly commentLookups: (readonly string[])[];
}

const unused = (): never => {
  throw new Error('この試験では呼ばれない');
};

async function caughtOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const harnessOf = (scenario: Scenario = {}): Harness => {
  const calls: string[] = [];
  const sent: EmailSendRequest<unknown>[] = [];
  const marks: Parameters<ModerationRecordStore['markNotice']>[0][] = [];
  const contactLookups: string[] = [];
  const productLookups: Harness['productLookups'] = [];
  const commentLookups: (readonly string[])[] = [];
  const records: ModerationRecordStore = {
    find: (id) => {
      calls.push('find');
      return Promise.resolve(
        scenario.record?.id === id ? scenario.record : undefined,
      );
    },
    markNotice: (input) => {
      calls.push(`mark:${input.to}`);
      marks.push(input);
      return scenario.markError === undefined
        ? Promise.resolve(scenario.markResult ?? true)
        : Promise.reject(scenario.markError);
    },
    latestFor: unused,
    listPendingNotices: unused,
    eraseBySubjectUser: unused,
    eraseByProduct: unused,
    eraseOccurredBefore: unused,
  };
  const contacts: UserContactDirectory = {
    findContact: (userId) => {
      contactLookups.push(userId);
      return Promise.resolve(
        (scenario.contacts ?? []).find((contact) => contact.userId === userId),
      );
    },
  };
  const products: ProductDirectory = {
    findSummaries: (ids, scope) => {
      productLookups.push({ ids, scope });
      return Promise.resolve(
        new Map(
          (scenario.products ?? [])
            .filter((product) => ids.includes(product.productId))
            .map((product) => [product.productId, product]),
        ),
      );
    },
    resolveHandle: unused,
    findDetail: unused,
    listLaunches: unused,
  };
  const comments: CommentStore = {
    findByIds: (ids) => {
      commentLookups.push(ids);
      return Promise.resolve(
        new Map(
          (scenario.comments ?? [])
            .filter((comment) => ids.includes(comment.commentId))
            .map((comment) => [comment.commentId, comment]),
        ),
      );
    },
  };
  const emails: EmailSender = {
    send: (request) => {
      calls.push('send');
      if (scenario.sendError !== undefined) {
        return Promise.reject(scenario.sendError);
      }
      sent.push(request);
      return Promise.resolve('01JQ0SND000000000000000001');
    },
  };
  const notifier = new EmailModerationNotifier(
    records,
    contacts,
    products,
    comments,
    emails,
    { CLIENT_SITE_ORIGIN: CLIENT_ORIGIN },
    { now: () => NOW },
  );
  return {
    notifier,
    calls,
    sent,
    marks,
    contactLookups,
    productLookups,
    commentLookups,
  };
};

const logs: LogRecord[] = [];

beforeEach(() => {
  logs.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        logs.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const moderationLogs = () =>
  logs
    .filter(
      (record) => record.category.join('.') === 'api.application.moderation',
    )
    .map(({ level, properties }) => ({ level, properties }));

const REQUESTED_MARK = {
  id: ACTION_ID,
  from: 'pending',
  to: 'requested',
  at: NOW,
} as const;

const SKIPPED_MARK = { ...REQUESTED_MARK, to: 'skipped' } as const;

describe('EmailModerationNotifier 停止の通知', () => {
  test('停止された利用者の登録メールアドレスへ、名前・理由・停止日時・問い合わせの導線を送り、送信の後に依頼済みにする', async () => {
    const harness = harnessOf({ record: recordOf(), contacts: [contactOf()] });

    const result = await harness.notifier.dispatch(ACTION_ID);

    expect(result).toBe('requested');
    expect(harness.contactLookups).toEqual([USER_ID]);
    expect(harness.sent).toEqual([
      {
        kind: MODERATION_USER_SUSPENDED_EMAIL,
        to: 'suspended@mail.example',
        input: {
          nickname: '停止された人',
          reason: '規約違反の投稿を繰り返したため',
          suspendedAt: '2026-11-20T04:21:00.000Z',
          contactUrl: 'https://client.example/contact',
        },
      },
    ]);
    expect(harness.calls).toEqual(['find', 'send', 'mark:requested']);
    expect(harness.marks).toEqual([REQUESTED_MARK]);
  });

  test('停止中の利用者も宛先の照会が返すため、そのまま送る', async () => {
    const harness = harnessOf({
      record: recordOf(),
      contacts: [contactOf({ emailVerified: false })],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('requested');
    expect(harness.sent.map(({ to }) => to)).toEqual([
      'suspended@mail.example',
    ]);
  });

  test('理由の前後の空白を除いた正規化した値を渡し、メール種別の入力の検証を通る', async () => {
    const harness = harnessOf({
      record: recordOf({ reason: '　 規約違反\n二行目 \n' }),
      contacts: [contactOf()],
    });

    await harness.notifier.dispatch(ACTION_ID);

    const input = harness.sent[0]?.input;
    expect(input).toMatchObject({ reason: '規約違反\n二行目' });
    expect(MODERATION_USER_SUSPENDED_EMAIL.inputSchema.parse(input)).toEqual(
      input as never,
    );
  });

  test('問い合わせの導線は利用者側のオリジンの/contactで組み立てる', async () => {
    const harness = harnessOf({ record: recordOf(), contacts: [contactOf()] });

    await harness.notifier.dispatch(ACTION_ID);

    expect(harness.sent[0]?.input).toMatchObject({
      contactUrl: `${CLIENT_ORIGIN}/contact`,
    });
  });
});

describe('EmailModerationNotifier プロダクトの非公開化の通知', () => {
  test('非公開化中のプロダクトを含めて名称を引き、投稿者の登録メールアドレスへ名前・名称・理由・日時を送る', async () => {
    const harness = harnessOf({
      record: productHideRecord(),
      products: [productOf()],
      contacts: [
        contactOf({ email: 'owner@mail.example', nickname: '投稿者' }),
      ],
    });

    const result = await harness.notifier.dispatch(ACTION_ID);

    expect(result).toBe('requested');
    expect(harness.productLookups).toEqual([
      { ids: [PRODUCT_ID], scope: 'not-deleted' },
    ]);
    expect(harness.contactLookups).toEqual([USER_ID]);
    expect(harness.sent).toEqual([
      {
        kind: MODERATION_PRODUCT_HIDDEN_EMAIL,
        to: 'owner@mail.example',
        input: {
          nickname: '投稿者',
          productName: '非公開化されたプロダクト',
          reason: '規約違反の投稿を繰り返したため',
          hiddenAt: '2026-11-20T04:21:00.000Z',
          contactUrl: 'https://client.example/contact',
        },
      },
    ]);
    expect(harness.marks).toEqual([REQUESTED_MARK]);
    expect(
      MODERATION_PRODUCT_HIDDEN_EMAIL.inputSchema.safeParse(
        harness.sent[0]?.input,
      ).success,
    ).toBe(true);
  });

  test('プロダクトが論理削除されていれば名称を引けないため、送らずに送らなかったことを記録する', async () => {
    const harness = harnessOf({
      record: productHideRecord(),
      products: [],
      contacts: [contactOf()],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('skipped');
    expect(harness.sent).toEqual([]);
    expect(harness.marks).toEqual([SKIPPED_MARK]);
  });

  test('投稿者が退会済み・物理削除済みなら、送らずに送らなかったことを記録する', async () => {
    const harness = harnessOf({
      record: productHideRecord(),
      products: [productOf()],
      contacts: [],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('skipped');
    expect(harness.sent).toEqual([]);
    expect(harness.calls).toEqual(['find', 'mark:skipped']);
  });
});

describe('EmailModerationNotifier コメントの非公開化の通知', () => {
  const commentScenario = (comment: CommentRecord): Scenario => ({
    record: commentHideRecord(),
    comments: [comment],
    products: [productOf()],
    contacts: [
      contactOf({
        userId: COMMENT_AUTHOR_ID,
        email: 'commenter@mail.example',
        nickname: 'コメントした人',
      }),
    ],
  });

  test('コメントの投稿者の登録メールアドレスへ、名前・対象のプロダクトの名称・本文の抜粋・理由・日時を送る', async () => {
    const harness = harnessOf(commentScenario(commentOf()));

    const result = await harness.notifier.dispatch(ACTION_ID);

    expect(result).toBe('requested');
    expect(harness.commentLookups).toEqual([[COMMENT_ID]]);
    expect(harness.productLookups).toEqual([
      { ids: [PRODUCT_ID], scope: 'not-deleted' },
    ]);
    expect(harness.contactLookups).toEqual([COMMENT_AUTHOR_ID]);
    expect(harness.sent).toEqual([
      {
        kind: MODERATION_COMMENT_HIDDEN_EMAIL,
        to: 'commenter@mail.example',
        input: {
          nickname: 'コメントした人',
          productName: '非公開化されたプロダクト',
          excerpt: '不適切なコメントの本文',
          reason: '規約違反の投稿を繰り返したため',
          hiddenAt: '2026-11-20T04:21:00.000Z',
          contactUrl: 'https://client.example/contact',
        },
      },
    ]);
    expect(harness.marks).toEqual([REQUESTED_MARK]);
  });

  test('本文がちょうど100書記素なら切らずにそのまま抜粋にする', async () => {
    const body = '👨‍👩‍👧'.repeat(50) + 'あ'.repeat(50);
    const harness = harnessOf(
      commentScenario(commentOf({ bodyMarkdown: body })),
    );

    await harness.notifier.dispatch(ACTION_ID);

    expect(harness.sent[0]?.input).toMatchObject({ excerpt: body });
  });

  test('本文が100書記素を超えれば、…を含めて100書記素に切り、メール種別の入力の検証を通る', async () => {
    const body = '👨‍👩‍👧'.repeat(60) + 'あ'.repeat(41);
    const harness = harnessOf(
      commentScenario(commentOf({ bodyMarkdown: body })),
    );

    await harness.notifier.dispatch(ACTION_ID);

    const input = harness.sent[0]?.input as { readonly excerpt: string };
    expect(input.excerpt).toBe(`${'👨‍👩‍👧'.repeat(60)}${'あ'.repeat(39)}…`);
    expect(countGraphemes(input.excerpt)).toBe(100);
    expect(
      MODERATION_COMMENT_HIDDEN_EMAIL.inputSchema.safeParse(input).success,
    ).toBe(true);
  });

  test.each([
    ['コメントが無い', undefined],
    [
      '匿名化されている',
      commentOf({
        authorUserId: null,
        bodyMarkdown: '',
        anonymizedAt: OCCURRED_AT,
      }),
    ],
  ])(
    'コメントが%sなら、送らずに送らなかったことを記録する',
    async (_label, comment) => {
      const harness = harnessOf({
        ...commentScenario(commentOf()),
        comments: comment === undefined ? [] : [comment],
      });

      expect(await harness.notifier.dispatch(ACTION_ID)).toBe('skipped');
      expect(harness.sent).toEqual([]);
      expect(harness.contactLookups).toEqual([]);
      expect(harness.marks).toEqual([SKIPPED_MARK]);
    },
  );

  test('コメントの投稿者が退会済み・物理削除済みなら、送らずに送らなかったことを記録する', async () => {
    const harness = harnessOf({
      ...commentScenario(commentOf()),
      contacts: [],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('skipped');
    expect(harness.sent).toEqual([]);
    expect(harness.marks).toEqual([SKIPPED_MARK]);
  });

  test('対象のプロダクトが論理削除されていれば、送らずに送らなかったことを記録する', async () => {
    const harness = harnessOf({
      ...commentScenario(commentOf()),
      products: [],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('skipped');
    expect(harness.sent).toEqual([]);
    expect(harness.marks).toEqual([SKIPPED_MARK]);
  });
});

describe('EmailModerationNotifier 送る対象と状態', () => {
  test.each([
    [
      '代理の退会などの送らない記録',
      recordOf({
        action: 'user.administrative-withdraw',
        noticeStatus: 'none',
      }),
    ],
    [
      '停止解除の送らない記録',
      recordOf({ action: 'user.unsuspend', noticeStatus: 'none' }),
    ],
    [
      '依頼済みの記録',
      recordOf({ noticeStatus: 'requested', noticeRequestedAt: OCCURRED_AT }),
    ],
    ['送らなかった記録', recordOf({ noticeStatus: 'skipped' })],
    ['存在しない記録', undefined],
  ])('%sは送らず、状態を変えない', async (_label, record) => {
    const harness = harnessOf({
      ...(record === undefined ? {} : { record }),
      contacts: [contactOf()],
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('not-pending');
    expect(harness.calls).toEqual(['find']);
    expect(harness.contactLookups).toEqual([]);
  });

  test('通知の無い種類の措置が依頼待ちなら、送らずに例外を投げる', async () => {
    const harness = harnessOf({
      record: recordOf({ action: 'rating.invalidate' }),
      contacts: [contactOf()],
    });

    expect(await caughtOf(harness.notifier.dispatch(ACTION_ID))).toEqual(
      new Error('通知の無い種類の措置が依頼待ちです: "rating.invalidate"'),
    );
    expect(harness.sent).toEqual([]);
    expect(harness.marks).toEqual([]);
  });

  test('理由の無い依頼待ちの記録は、送らずに例外を投げて依頼待ちのまま残す', async () => {
    const harness = harnessOf({
      record: recordOf({ reason: null }),
      contacts: [contactOf()],
    });

    expect(await caughtOf(harness.notifier.dispatch(ACTION_ID))).toBeInstanceOf(
      Error,
    );
    expect(harness.sent).toEqual([]);
    expect(harness.marks).toEqual([]);
  });

  test('送らなかった記録への更新が他の処理に先を越されたら、依頼待ちでなかったとして返す', async () => {
    const harness = harnessOf({
      record: recordOf(),
      contacts: [],
      markResult: false,
    });

    expect(await harness.notifier.dispatch(ACTION_ID)).toBe('not-pending');
    expect(harness.marks).toEqual([SKIPPED_MARK]);
  });
});

describe('EmailModerationNotifier 送信の失敗', () => {
  test('送信の依頼に失敗したら、依頼待ちのまま例外を投げる', async () => {
    const failure = new Error('Queueへの送信に失敗しました');
    const harness = harnessOf({
      record: recordOf(),
      contacts: [contactOf()],
      sendError: failure,
    });

    expect(await caughtOf(harness.notifier.dispatch(ACTION_ID))).toBe(failure);
    expect(harness.calls).toEqual(['find', 'send']);
    expect(harness.marks).toEqual([]);
  });

  test('送信の後に依頼済みへの更新だけが失敗したら、措置のIDを添えたwarningのログを出して例外を投げる', async () => {
    const failure = new Error('D1への書き込みに失敗しました');
    const harness = harnessOf({
      record: recordOf(),
      contacts: [contactOf()],
      markError: failure,
    });

    expect(await caughtOf(harness.notifier.dispatch(ACTION_ID))).toBe(failure);
    expect(harness.calls).toEqual(['find', 'send', 'mark:requested']);
    expect(moderationLogs()).toEqual([
      {
        level: 'warning',
        properties: { error: failure, actionId: ACTION_ID },
      },
    ]);
  });

  test('ログに宛先・名前・理由を含めない', async () => {
    const harness = harnessOf({
      record: recordOf(),
      contacts: [contactOf()],
      markError: new Error('D1への書き込みに失敗しました'),
    });

    await harness.notifier.dispatch(ACTION_ID).catch(() => undefined);

    const serialized = JSON.stringify(
      logs.map(({ message, properties }) => ({ message, properties })),
    );
    expect(serialized).not.toContain('suspended@mail.example');
    expect(serialized).not.toContain('停止された人');
    expect(serialized).not.toContain('規約違反');
  });
});
