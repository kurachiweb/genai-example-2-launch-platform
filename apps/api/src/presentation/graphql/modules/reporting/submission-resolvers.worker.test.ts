import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/reporting/report-rules.ts';
import { reportCases } from '../../../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../../../db/schema/reporting/reports.ts';
import {
  clearIdentityTables,
  db,
  insertUser,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  createGraphQLGateway,
  type GatewayCallOptions,
  type GatewayResponse,
  randomClientIp,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import { issueUserSession } from '../../../../../test/support/profile-graphql-operations.ts';
import { reportingSchemaModule } from './index.ts';

const REPORTER = 1;

const TARGET_OWNER = 2;

const SUSPENDED_REPORTER = 3;

const TARGET_HANDLE = `user${String(TARGET_OWNER)}`;

const CUSTOM_CATEGORY_ID = '01JE0RCTG00000000000000001';

const MISSING_CATEGORY_ID = '01JE0RCTG00000000000000099';

const T0 = new Date('2026-11-22T00:00:00.000Z');

const REPORT_BOT_TOKEN = botTokenFor('report');

const CONTACT_DOMAIN = '@mail.example';

const CONTACT_EMAIL_AT_MAX = `${'a'.repeat(254 - CONTACT_DOMAIN.length)}${CONTACT_DOMAIN}`;

const CONTACT_EMAIL_TOO_LONG = `a${CONTACT_EMAIL_AT_MAX}`;

const REPORT_CATEGORIES = /* GraphQL */ `
  query ClientReportCategories {
    reportCategories {
      id
      name
      infringement
    }
  }
`;

const SUBMIT_REPORT = /* GraphQL */ `
  mutation ClientSubmitReport($input: SubmitReportInput!) {
    submitReport(input: $input) {
      accepted
    }
  }
`;

const gateway = createGraphQLGateway({
  documents: [REPORT_CATEGORIES, SUBMIT_REPORT],
  schemaModules: [reportingSchemaModule],
});

interface ReportCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly infringement: boolean;
}

function fetchReportCategories(options?: GatewayCallOptions) {
  return gateway.call<{ reportCategories: ReportCategoryFields[] | null }>(
    REPORT_CATEGORIES,
    {},
    options,
  );
}

function submitReport(
  input: Record<string, unknown>,
  options: GatewayCallOptions = { botToken: REPORT_BOT_TOKEN },
) {
  return gateway.call<{ submitReport: { accepted: boolean } | null }>(
    SUBMIT_REPORT,
    { input },
    options,
  );
}

function reportInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    targetKind: 'USER',
    targetRef: TARGET_HANDLE,
    categoryId: REPORT_CATEGORY_OTHER_ID,
    reason: '他の利用者になりすましています',
    ...overrides,
  };
}

function infringementInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return reportInput({
    categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
    reason: '私が撮影した写真を無断で使っています',
    ...overrides,
  });
}

function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

async function memberSession(): Promise<string> {
  await insertUser(REPORTER);
  return issueUserSession(REPORTER);
}

async function suspendedSession(): Promise<string> {
  await insertUser(SUSPENDED_REPORTER, {
    status: 'suspended',
    suspendedAt: T0,
  });
  return issueUserSession(SUSPENDED_REPORTER);
}

async function readReports() {
  return db
    .select({
      reporterUserId: reports.reporterUserId,
      contactEmail: reports.contactEmail,
      categoryId: reports.categoryId,
      categoryName: reports.categoryName,
      reason: reports.reason,
    })
    .from(reports)
    .orderBy(asc(reports.reportedAt), asc(reports.id));
}

async function readCases() {
  return db
    .select({
      targetKind: reportCases.targetKind,
      targetId: reportCases.targetId,
      status: reportCases.status,
      infringementReportedAt: reportCases.infringementReportedAt,
    })
    .from(reportCases);
}

// 標準カテゴリはマイグレーションの初期データで常に入るため残す
beforeEach(async () => {
  await db.batch([
    db.delete(reports),
    db.delete(reportCases),
    db
      .delete(reportCategories)
      .where(eq(reportCategories.systemDefault, false)),
  ]);
  await clearIdentityTables();
  await insertUser(TARGET_OWNER);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportCategories', () => {
  test('未ログインでも、追加したカテゴリの後に「権利侵害」「その他」の順で並べ、権利侵害だけに印を付ける', async () => {
    await db.insert(reportCategories).values({
      id: CUSTOM_CATEGORY_ID,
      name: 'スパム',
      createdAt: T0,
      updatedAt: T0,
    });

    const response = await fetchReportCategories();

    expect(response.errors).toBeUndefined();
    expect(response.data?.reportCategories).toEqual([
      { id: CUSTOM_CATEGORY_ID, name: 'スパム', infringement: false },
      {
        id: REPORT_CATEGORY_INFRINGEMENT_ID,
        name: REPORT_CATEGORY_INFRINGEMENT_NAME,
        infringement: true,
      },
      {
        id: REPORT_CATEGORY_OTHER_ID,
        name: REPORT_CATEGORY_OTHER_NAME,
        infringement: false,
      },
    ]);
  });
});

describe('submitReportの呼び出し元の確認', () => {
  test('管理者側の呼び出し元からの通報は、入力の検証とbot判定の前にforbiddenで拒否する', async () => {
    const calls = stubExternalServices();

    const response = await submitReport(reportInput({ reason: '' }), {
      caller: 'admin',
      botToken: REPORT_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(detailsOf(response)).toEqual([]);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readReports()).toEqual([]);
  });
});

describe('submitReportのbot判定', () => {
  test('通報の操作名でbot判定を求め、成功すれば受け付ける', async () => {
    const calls = stubExternalServices();

    const response = await submitReport(reportInput());

    expect(response.errors).toBeUndefined();
    expect(response.data?.submitReport).toEqual({ accepted: true });
    expect(calls.siteverifyTokens).toEqual([REPORT_BOT_TOKEN]);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    ['判定に失敗する', BOT_REJECTED_TOKEN, 'bot_verification_failed'],
    [
      '他の操作名の判定の結果である',
      botTokenFor('inquiry_guest'),
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は保存せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();

    const response = await submitReport(
      reportInput(),
      botToken === undefined ? {} : { botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect(await readReports()).toEqual([]);
  });
});

describe('submitReportの入力の誤り', () => {
  test.each([
    ['空白だけの理由', { reason: ' \n　' }, '理由を入力してください。'],
    [
      '1,001書記素の理由',
      { reason: '👨‍👩‍👧'.repeat(1001) },
      '理由は1,000文字以内で入力してください。',
    ],
  ])(
    '%sはbot判定を呼ばずに理由の欄のvalidation_errorにする',
    async (_name, overrides, message) => {
      const calls = stubExternalServices();

      const response = await submitReport(reportInput(overrides));

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: 'input.reason', code: 'custom', message },
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readReports()).toEqual([]);
    },
  );

  test.each([
    ['未ログイン', () => Promise.resolve(undefined)],
    ['停止中', suspendedSession],
  ])(
    '%sの権利侵害の通報で連絡先が無ければ、bot判定を呼ばずに連絡先の欄のrequiredにする',
    async (_name, sessionOf) => {
      const calls = stubExternalServices();
      const sessionToken = await sessionOf();

      const response = await submitReport(
        infringementInput({ contactEmail: '  ' }),
        {
          botToken: REPORT_BOT_TOKEN,
          ...(sessionToken !== undefined && { sessionToken }),
        },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.contactEmail',
          code: 'required',
          message: '連絡先メールアドレスを入力してください。',
        },
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readReports()).toEqual([]);
    },
  );

  test.each([
    ['未ログイン', () => Promise.resolve(undefined)],
    ['停止中', suspendedSession],
  ])(
    '%sの権利侵害の通報で連絡先の形式が誤っていれば、bot判定を呼ばずに連絡先の欄のinvalid-formatにする',
    async (_name, sessionOf) => {
      const calls = stubExternalServices();
      const sessionToken = await sessionOf();

      const response = await submitReport(
        infringementInput({ contactEmail: 'owner.mail.example' }),
        {
          botToken: REPORT_BOT_TOKEN,
          ...(sessionToken !== undefined && { sessionToken }),
        },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.contactEmail',
          code: 'invalid-format',
          message: 'メールアドレスの形式が正しくありません。',
        },
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readReports()).toEqual([]);
    },
  );

  test.each([
    ['未ログイン', () => Promise.resolve(undefined)],
    ['停止中', suspendedSession],
  ])(
    '%sの権利侵害の通報で連絡先が255文字なら、bot判定を呼ばずに連絡先の欄のtoo-longにする',
    async (_name, sessionOf) => {
      const calls = stubExternalServices();
      const sessionToken = await sessionOf();

      const response = await submitReport(
        infringementInput({ contactEmail: CONTACT_EMAIL_TOO_LONG }),
        {
          botToken: REPORT_BOT_TOKEN,
          ...(sessionToken !== undefined && { sessionToken }),
        },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.contactEmail',
          code: 'too-long',
          message: 'メールアドレスは254文字以内で入力してください。',
        },
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readReports()).toEqual([]);
    },
  );

  test('存在しないカテゴリは、ユースケースの詳細の欄に入力の経路を付けてvalidation_errorにする', async () => {
    stubExternalServices();

    const response = await submitReport(
      reportInput({ categoryId: MISSING_CATEGORY_ID }),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.categoryId',
        code: 'not-found',
        message: 'カテゴリを選んでください。',
      },
    ]);
    expect(await readReports()).toEqual([]);
  });
});

describe('submitReportの受け付け', () => {
  test('未ログインの権利侵害の通報は、前後の空白を除いた連絡先とともに通報者を記録せずに受け付け、権利侵害の案件を作る', async () => {
    stubExternalServices();

    const response = await submitReport(
      infringementInput({ contactEmail: ' owner@mail.example ' }),
    );

    expect(response.data?.submitReport).toEqual({ accepted: true });
    expect(await readReports()).toEqual([
      {
        reporterUserId: null,
        contactEmail: 'owner@mail.example',
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
        reason: '私が撮影した写真を無断で使っています',
      },
    ]);
    expect(await readCases()).toEqual([
      {
        targetKind: 'user',
        targetId: userIdOf(TARGET_OWNER),
        status: 'open',
        infringementReportedAt: expect.any(Date) as Date,
      },
    ]);
  });

  test('停止中の利用者の権利侵害の通報は、未ログインと同じく連絡先とともに通報者を記録せずに受け付ける', async () => {
    stubExternalServices();
    const sessionToken = await suspendedSession();

    const response = await submitReport(
      infringementInput({ contactEmail: 'owner@mail.example' }),
      { botToken: REPORT_BOT_TOKEN, sessionToken },
    );

    expect(response.data?.submitReport).toEqual({ accepted: true });
    expect(await readReports()).toEqual([
      expect.objectContaining({
        reporterUserId: null,
        contactEmail: 'owner@mail.example',
      }),
    ]);
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    'ログイン中の利用者の%sの通報は、送られた連絡先を捨てて通報者として記録する',
    async (_name, categoryId) => {
      stubExternalServices();
      const sessionToken = await memberSession();

      const response = await submitReport(
        reportInput({ categoryId, contactEmail: 'not an email' }),
        { botToken: REPORT_BOT_TOKEN, sessionToken },
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.submitReport).toEqual({ accepted: true });
      expect(await readReports()).toEqual([
        expect.objectContaining({
          reporterUserId: userIdOf(REPORTER),
          contactEmail: null,
          categoryId,
        }),
      ]);
    },
  );

  test('未ログインの権利侵害の通報は、前後の空白を除いて254文字の連絡先を受け付ける', async () => {
    stubExternalServices();

    const response = await submitReport(
      infringementInput({ contactEmail: ` ${CONTACT_EMAIL_AT_MAX} ` }),
    );

    expect(response.errors).toBeUndefined();
    expect(await readReports()).toEqual([
      expect.objectContaining({
        reporterUserId: null,
        contactEmail: CONTACT_EMAIL_AT_MAX,
      }),
    ]);
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    'ログイン中の利用者の%sの通報は、255文字の連絡先でも拒否せずに捨てる',
    async (_name, categoryId) => {
      stubExternalServices();
      const sessionToken = await memberSession();

      const response = await submitReport(
        reportInput({ categoryId, contactEmail: CONTACT_EMAIL_TOO_LONG }),
        { botToken: REPORT_BOT_TOKEN, sessionToken },
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.submitReport).toEqual({ accepted: true });
      expect(await readReports()).toEqual([
        expect.objectContaining({
          reporterUserId: userIdOf(REPORTER),
          contactEmail: null,
        }),
      ]);
    },
  );

  test('未ログインの権利侵害以外の通報は、255文字の連絡先でも拒否せずに捨てる', async () => {
    stubExternalServices();

    const response = await submitReport(
      reportInput({ contactEmail: CONTACT_EMAIL_TOO_LONG }),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.submitReport).toEqual({ accepted: true });
    expect(await readReports()).toEqual([
      expect.objectContaining({ reporterUserId: null, contactEmail: null }),
    ]);
  });

  test('未ログインの権利侵害以外の通報は、送られた連絡先を検証せずに捨てる', async () => {
    stubExternalServices();

    const response = await submitReport(
      reportInput({ contactEmail: 'not an email' }),
    );

    expect(response.errors).toBeUndefined();
    expect(await readReports()).toEqual([
      expect.objectContaining({ reporterUserId: null, contactEmail: null }),
    ]);
  });
});

describe('submitReportの拒否', () => {
  test.each([
    ['存在しないハンドルのユーザー', { targetRef: 'nobody' }],
    [
      '存在しないプロダクト',
      { targetKind: 'PRODUCT', targetRef: '01JE0PRDT00000000000000099' },
    ],
  ])(
    '%sへの通報は、bot判定の後にreport_target_not_foundで拒否する',
    async (_name, overrides) => {
      const calls = stubExternalServices();

      const response = await submitReport(reportInput(overrides));

      expect(codesOf(response)).toEqual(['report_target_not_found']);
      expect(response.errors?.[0]?.message).toBe(
        '通報の対象が見つかりません。ページを読み込み直してください。',
      );
      expect(calls.siteverifyTokens).toEqual([REPORT_BOT_TOKEN]);
      expect(await readReports()).toEqual([]);
    },
  );

  test('ログイン中の利用者が自分を通報すると、report_own_contentで拒否する', async () => {
    stubExternalServices();
    const sessionToken = await memberSession();

    const response = await submitReport(
      reportInput({ targetRef: `user${String(REPORTER)}` }),
      { botToken: REPORT_BOT_TOKEN, sessionToken },
    );

    expect(codesOf(response)).toEqual(['report_own_content']);
    expect(response.errors?.[0]?.message).toBe(
      '自分のコンテンツは通報できません。',
    );
    expect(await readReports()).toEqual([]);
  });

  test('同じ送信元IPアドレスからの11回目の通報は、保存せずに429と再試行までの秒数で拒否する', async () => {
    stubExternalServices();
    const clientIp = randomClientIp();
    const send = () =>
      submitReport(reportInput(), { botToken: REPORT_BOT_TOKEN, clientIp });
    for (let count = 0; count < 10; count += 1) {
      expect((await send()).data?.submitReport).toEqual({ accepted: true });
    }

    const response = await send();

    expect(response.status).toBe(429);
    expect(codesOf(response)).toEqual(['rate_limit_exceeded']);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await readReports()).toHaveLength(10);
  });
});
