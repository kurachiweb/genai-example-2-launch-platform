import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
  type ReportTargetKind,
} from '../../../common-lib/reporting/report-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type {
  ReportCategoryRecord,
  ReportCategoryStore,
  ReportRequestMeta,
  ReportSubmissionInput,
  ReportSubmissionRateLimit,
  ReportSubmissionRecord,
  ReportSubmissionService,
  ReportSubmissionStore,
  ReportSubmitter,
  ReportTargetResolver,
  ResolvedReportTarget,
} from './ports.ts';
import { DefaultReportSubmissionService } from './report-submission-service.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

const NOW = new Date('2027-05-01T09:00:00.000Z');
const USER_ID = '01JQ0USR000000000000000001';
const OWNER_ID = '01JQ0USR000000000000000002';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const CATEGORY_ID = '01JQ0CAT000000000000000001';
const REPORT_ID = '01JQ0REP000000000000000001';
const NEW_CASE_ID = '01JQ0CAS000000000000000001';
const CLIENT_IP = '192.0.2.10';
const CONTACT_EMAIL = 'reporter@mail.example';
const MEMBER_EMAIL = 'member@mail.example';
const REASON = '他人の作品を無断で転載しています。';
const TARGET_HANDLE = 'reported-handle';

const SESSION: SessionView = Object.freeze({
  principal: () => Promise.resolve({ kind: 'anonymous' as const }),
});

const META: ReportRequestMeta = Object.freeze({
  clientIp: CLIENT_IP,
  now: NOW,
});

const categoryOf = (id: string): ReportCategoryRecord => ({
  id,
  name: id === REPORT_CATEGORY_INFRINGEMENT_ID ? '権利侵害' : 'スパム',
  systemDefault: id === REPORT_CATEGORY_INFRINGEMENT_ID,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
});

const PRODUCT_TARGET: ResolvedReportTarget = Object.freeze({
  kind: 'product',
  targetId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  productId: PRODUCT_ID,
});

const inputOf = (
  overrides: Partial<ReportSubmissionInput> = {},
): ReportSubmissionInput => ({
  targetKind: 'product',
  targetRef: PRODUCT_ID,
  categoryId: CATEGORY_ID,
  reason: REASON,
  contactEmail: undefined,
  ...overrides,
});

const userOf = (
  status: UserAccountView['status'],
  userId: string = USER_ID,
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JQ0SES000000000000000001',
  },
  user: {
    id: userId,
    pseudonymousId: '01JQ0PSE000000000000000001',
    status,
    emailVerifiedAt: NOW,
    deletedAt: null,
    email: MEMBER_EMAIL,
    nickname: '通報するひと',
    handle: 'reporter',
  },
});

interface FakeOptions {
  readonly currentUser?: CurrentUser;
  readonly categories?: readonly string[];
  readonly target?: ResolvedReportTarget | null;
  readonly rateLimitError?: AppError;
  readonly storeResult?: 'accepted' | 'category-missing';
}

interface Consumed {
  readonly submitter: ReportSubmitter;
  readonly clientIp: string | undefined;
  readonly now: Date;
}

const notExpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const consumed: Consumed[] = [];
  const submitted: ReportSubmissionRecord[] = [];
  const resolved: { kind: ReportTargetKind; ref: string }[] = [];
  const categories = options.categories ?? [
    CATEGORY_ID,
    REPORT_CATEGORY_INFRINGEMENT_ID,
    REPORT_CATEGORY_OTHER_ID,
  ];
  const target =
    options.target === null ? undefined : (options.target ?? PRODUCT_TARGET);
  const guard: AccountGuard = {
    currentUser: () => {
      calls.push('currentUser');
      return Promise.resolve(options.currentUser);
    },
    requireUser: notExpected,
    requireWritableUser: notExpected,
    requireVerifiedUser: notExpected,
  };
  const categoryStore: ReportCategoryStore = {
    list: notExpected,
    find: (id) => {
      calls.push('findCategory');
      return Promise.resolve(
        categories.includes(id) ? categoryOf(id) : undefined,
      );
    },
    countReports: notExpected,
    insert: notExpected,
    rename: notExpected,
    deleteAndReassign: notExpected,
  };
  const targets: ReportTargetResolver = {
    resolveForSubmission: (kind, ref) => {
      calls.push('resolveTarget');
      resolved.push({ kind, ref });
      return Promise.resolve(target);
    },
    describe: notExpected,
  };
  const rateLimit: ReportSubmissionRateLimit = {
    consume: (submitter, clientIp, now) => {
      calls.push('consume');
      consumed.push({ submitter, clientIp, now });
      return options.rateLimitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.rateLimitError);
    },
  };
  const store: ReportSubmissionStore = {
    submit: (record) => {
      calls.push('submit');
      submitted.push(record);
      return Promise.resolve(options.storeResult ?? 'accepted');
    },
  };
  const generated = [REPORT_ID, NEW_CASE_ID];
  const ids: IdGenerator = {
    generate: () => {
      const next = generated.shift();
      if (next === undefined) {
        throw new Error('IDを用意していません');
      }
      return next;
    },
  };
  const service = new DefaultReportSubmissionService(
    guard,
    categoryStore,
    targets,
    rateLimit,
    store,
    ids,
  );
  return { service, calls, consumed, submitted, resolved };
}

async function caught(action: Promise<unknown>): Promise<AppError> {
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

const reportingLogs = () =>
  logs
    .filter(
      (record) => record.category.join('.') === 'api.reporting.submission',
    )
    .map(({ level, properties }) => ({ level, properties }));

describe('DefaultReportSubmissionService の通報者の判定', () => {
  test('停止していないログイン中の利用者は利用者として記録し、連絡先を記録しない', async () => {
    const { service, consumed, submitted } = setup({
      currentUser: userOf('active'),
    });

    await service.submit(
      SESSION,
      inputOf({
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        contactEmail: CONTACT_EMAIL,
      }),
      META,
    );

    expect(consumed.map(({ submitter }) => submitter)).toEqual([
      { kind: 'member', userId: USER_ID },
    ]);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.reporterUserId).toBe(USER_ID);
    expect(submitted[0]?.contactEmail).toBeNull();
  });

  test('未ログインの通報は通報者を記録せずguestとして数える', async () => {
    const { service, consumed, submitted } = setup();

    await service.submit(SESSION, inputOf(), META);

    expect(consumed.map(({ submitter }) => submitter)).toEqual([
      { kind: 'guest' },
    ]);
    expect(submitted[0]?.reporterUserId).toBeNull();
    expect(submitted[0]?.contactEmail).toBeNull();
  });

  test('停止中の利用者の通報は未ログインの通報として扱い、利用者に結び付けない', async () => {
    const { service, consumed, submitted } = setup({
      currentUser: userOf('suspended'),
    });

    await service.submit(
      SESSION,
      inputOf({
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        contactEmail: CONTACT_EMAIL,
      }),
      META,
    );

    expect(consumed.map(({ submitter }) => submitter)).toEqual([
      { kind: 'guest' },
    ]);
    expect(submitted[0]?.reporterUserId).toBeNull();
    expect(submitted[0]?.contactEmail).toBe(CONTACT_EMAIL);
  });

  test.each([
    ['未ログイン', undefined],
    ['停止中', userOf('suspended')],
  ] as const)(
    'リゾルバの判定の後に%sの権利侵害の通報になり連絡先が無ければ、連絡先の欄の誤りにして数えず書き込まない',
    async (_label, currentUser) => {
      const { service, calls } = setup({ currentUser });

      const error = await caught(
        service.submit(
          SESSION,
          inputOf({ categoryId: REPORT_CATEGORY_INFRINGEMENT_ID }),
          META,
        ),
      );

      expect({
        kind: error.kind,
        code: error.code,
        details: error.details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [
          {
            field: 'contactEmail',
            code: 'required',
            message: '連絡先メールアドレスを入力してください。',
          },
        ],
      });
      expect(calls).toEqual(['currentUser']);
    },
  );

  test('連絡先が要らない未ログインの通報では、渡された連絡先を捨てる', async () => {
    const { service, submitted } = setup();

    await service.submit(
      SESSION,
      inputOf({
        categoryId: REPORT_CATEGORY_OTHER_ID,
        contactEmail: CONTACT_EMAIL,
      }),
      META,
    );

    expect(submitted[0]?.contactEmail).toBeNull();
  });
});

describe('DefaultReportSubmissionService のカテゴリと対象', () => {
  test('カテゴリが無ければカテゴリの欄の誤りにし、対象を照会しない', async () => {
    const { service, calls } = setup({ categories: [] });

    const error = await caught(service.submit(SESSION, inputOf(), META));

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
          message: 'カテゴリを選んでください。',
        },
      ],
    });
    expect(calls).toEqual(['currentUser', 'findCategory']);
  });

  test('保存の時点でカテゴリが削除されていれば、カテゴリの欄の誤りにする', async () => {
    const { service, calls } = setup({ storeResult: 'category-missing' });

    const error = await caught(service.submit(SESSION, inputOf(), META));

    expect(error.code).toBe('validation_error');
    expect(error.details).toEqual([
      {
        field: 'categoryId',
        code: 'not-found',
        message: 'カテゴリを選んでください。',
      },
    ]);
    expect(calls.at(-1)).toBe('submit');
  });

  test('表示されている対象が見つからなければ、数えずに対象の不在で拒否する', async () => {
    const { service, calls, resolved } = setup({ target: null });

    const error = await caught(
      service.submit(
        SESSION,
        inputOf({ targetKind: 'user', targetRef: TARGET_HANDLE }),
        META,
      ),
    );

    expect(error.kind).toBe('not_found');
    expect(STATUS_BY_KIND[error.kind]).toBe(404);
    expect(error.code).toBe('report_target_not_found');
    expect(error.message).toBe(
      '通報の対象が見つかりません。ページを読み込み直してください。',
    );
    expect(resolved).toEqual([{ kind: 'user', ref: TARGET_HANDLE }]);
    expect(calls).not.toContain('consume');
    expect(calls).not.toContain('submit');
  });

  test.each([
    ['停止していない', 'active'],
    ['停止中の', 'suspended'],
  ] as const)(
    '%s本人の自分のコンテンツの通報は、数えずに拒否する',
    async (_label, status) => {
      const { service, calls } = setup({
        currentUser: userOf(status, OWNER_ID),
      });

      const error = await caught(service.submit(SESSION, inputOf(), META));

      expect(error.kind).toBe('unprocessable');
      expect(STATUS_BY_KIND[error.kind]).toBe(422);
      expect(error.code).toBe('report_own_content');
      expect(error.message).toBe('自分のコンテンツは通報できません。');
      expect(calls).not.toContain('consume');
      expect(calls).not.toContain('submit');
    },
  );
});

describe('DefaultReportSubmissionService の回数制限と保存', () => {
  test('対象の確認の後に、通報者の種類・送信元IPアドレス・要求の時刻で回数制限を呼び、その後に保存する', async () => {
    const { service, calls, consumed } = setup({
      currentUser: userOf('active'),
    });

    await service.submit(SESSION, inputOf(), META);

    expect(calls).toEqual([
      'currentUser',
      'findCategory',
      'resolveTarget',
      'consume',
      'submit',
    ]);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.submitter).toEqual({ kind: 'member', userId: USER_ID });
    expect(consumed[0]?.clientIp).toBe(CLIENT_IP);
    expect(consumed[0]?.now).toBe(NOW);
  });

  test('送信元IPアドレスが不明でも、不明のまま回数制限へ渡す', async () => {
    const { service, consumed } = setup();

    await service.submit(SESSION, inputOf(), { clientIp: undefined, now: NOW });

    expect(consumed[0]?.clientIp).toBeUndefined();
  });

  test('上限を超えたら回数制限の例外をそのまま返し、書き込まない', async () => {
    const limited = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 1200,
    });
    const { service, calls } = setup({ rateLimitError: limited });

    const error = await caught(service.submit(SESSION, inputOf(), META));

    expect(error).toBe(limited);
    expect(calls).not.toContain('submit');
  });

  test('通報と新しい案件のIDと、対象・カテゴリ・理由・要求の時刻を保存へ渡す', async () => {
    const { service, submitted } = setup();

    await service.submit(SESSION, inputOf(), META);

    expect(submitted).toEqual([
      {
        reportId: REPORT_ID,
        newCaseId: NEW_CASE_ID,
        target: PRODUCT_TARGET,
        reporterUserId: null,
        contactEmail: null,
        categoryId: CATEGORY_ID,
        reason: REASON,
        infringement: false,
        at: NOW,
      },
    ]);
    expect(submitted[0]?.at).toBe(NOW);
  });

  test('権利侵害のカテゴリの通報は権利侵害の印を付ける', async () => {
    const { service, submitted } = setup();

    await service.submit(
      SESSION,
      inputOf({
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        contactEmail: CONTACT_EMAIL,
      }),
      META,
    );

    expect(submitted[0]?.infringement).toBe(true);
    expect(submitted[0]?.contactEmail).toBe(CONTACT_EMAIL);
  });
});

describe('DefaultReportSubmissionService のログ', () => {
  test('受け付けたら識別子と種類だけを1件記録する', async () => {
    const { service } = setup({ currentUser: userOf('active') });

    await service.submit(SESSION, inputOf(), META);

    expect(reportingLogs()).toEqual([
      {
        level: 'info',
        properties: {
          reportId: REPORT_ID,
          targetKind: 'product',
          targetId: PRODUCT_ID,
          categoryId: CATEGORY_ID,
          submitterKind: 'member',
          result: 'accepted',
        },
      },
    ]);
  });

  test.each([
    ['対象の不在', { target: null }, 'target-not-found'],
    [
      '自分のコンテンツ',
      { currentUser: userOf('active', OWNER_ID) },
      'own-content',
    ],
    ['カテゴリの不在', { categories: [] }, 'category-missing'],
    [
      '保存の時点のカテゴリの不在',
      { storeResult: 'category-missing' },
      'category-missing',
    ],
  ] as const)('%sで拒否した結果を記録する', async (_label, options, result) => {
    const { service } = setup(options);

    await caught(service.submit(SESSION, inputOf(), META));

    expect(reportingLogs()).toMatchObject([
      { level: 'info', properties: { result } },
    ]);
  });

  test('ログにメールアドレス・理由・送信元IPアドレス・ハンドルを含めない', async () => {
    const guestInfringement = setup();
    await guestInfringement.service.submit(
      SESSION,
      inputOf({
        targetKind: 'user',
        targetRef: TARGET_HANDLE,
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        contactEmail: CONTACT_EMAIL,
      }),
      META,
    );
    const member = setup({ currentUser: userOf('active'), target: null });
    await caught(
      member.service.submit(
        SESSION,
        inputOf({ targetKind: 'user', targetRef: TARGET_HANDLE }),
        META,
      ),
    );

    const serialized = JSON.stringify(
      logs.map(({ message, properties }) => ({ message, properties })),
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [
      CONTACT_EMAIL,
      MEMBER_EMAIL,
      REASON,
      CLIENT_IP,
      TARGET_HANDLE,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('DefaultReportSubmissionService の注入', () => {
  test('コンテナで依存を注入して解決できる', async () => {
    const fakes = setup();
    const container = new Container();
    container.bind(IDENTITY_PLATFORM_TYPES.AccountGuard).toConstantValue({
      currentUser: () => Promise.resolve(undefined),
    } satisfies Partial<AccountGuard>);
    container.bind(REPORTING_TYPES.ReportCategoryStore).toConstantValue({
      find: (id: string) => Promise.resolve(categoryOf(id)),
    } satisfies Partial<ReportCategoryStore>);
    container.bind(REPORTING_TYPES.ReportTargetResolver).toConstantValue({
      resolveForSubmission: () => Promise.resolve(PRODUCT_TARGET),
    } satisfies Partial<ReportTargetResolver>);
    container.bind(REPORTING_TYPES.ReportSubmissionRateLimit).toConstantValue({
      consume: () => Promise.resolve(),
    } satisfies ReportSubmissionRateLimit);
    container.bind(REPORTING_TYPES.ReportSubmissionStore).toConstantValue({
      submit: (record: ReportSubmissionRecord) => {
        fakes.submitted.push(record);
        return Promise.resolve('accepted' as const);
      },
    } satisfies ReportSubmissionStore);
    container.bind(PLATFORM_TYPES.IdGenerator).toConstantValue({
      generate: () => REPORT_ID,
    } satisfies IdGenerator);
    container
      .bind<ReportSubmissionService>(REPORTING_TYPES.ReportSubmissionService)
      .to(DefaultReportSubmissionService);

    const service = container.get<ReportSubmissionService>(
      REPORTING_TYPES.ReportSubmissionService,
    );
    await service.submit(SESSION, inputOf(), META);

    expect(fakes.submitted).toHaveLength(1);
  });
});
