import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { INQUIRY_ATTACHMENT_PURPOSE } from '../../common-lib/inquiry/inquiry-attachment-limits.ts';
import { INQUIRY_CATEGORY_OTHER_ID } from '../../common-lib/inquiry/inquiry-category-constants.ts';
import { ATTACHMENT_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  type UploadedFile,
} from '../../common-lib/media/upload-protocol.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearMediaState,
  concatBytes,
  countRecords,
  pdfBytes,
  readRecord,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import { issueAdminSession } from '../../test/support/admin-graphql-harness.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { StoreGuestInquirySubmission } from '../application/inquiry/guest-inquiry-submission.ts';
import { StoreInquiryAdminService } from '../application/inquiry/inquiry-admin-service.ts';
import { MediaInquiryAttachmentBinder } from '../application/inquiry/inquiry-attachment-binder.ts';
import { StoreInquiryCategoryService } from '../application/inquiry/inquiry-category-service.ts';
import { StoreInquiryChatService } from '../application/inquiry/inquiry-chat-service.ts';
import { StoreInquiryReplyService } from '../application/inquiry/inquiry-reply-service.ts';
import { StoreInquiryStatusService } from '../application/inquiry/inquiry-status-service.ts';
import { INQUIRY_TYPES } from '../application/inquiry/inquiry-types.ts';
import { GuestInquiryRetentionJob } from '../application/inquiry/jobs/guest-inquiry-retention-job.ts';
import { StoreMemberInquirySubmission } from '../application/inquiry/member-inquiry-submission.ts';
import type { InquirySettings } from '../application/inquiry/ports.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { UserLifecycleCommitter } from '../application/identity/ports.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import { CounterGuestInquiryRateLimit } from '../infrastructure/inquiry/counter-guest-inquiry-rate-limit.ts';
import { D1GuestInquiryStore } from '../infrastructure/inquiry/d1-guest-inquiry-store.ts';
import { D1InquirerProfiles } from '../infrastructure/inquiry/d1-inquirer-profiles.ts';
import { D1InquiryAdminReader } from '../infrastructure/inquiry/d1-inquiry-admin-reader.ts';
import { D1InquiryCategoryStore } from '../infrastructure/inquiry/d1-inquiry-category-store.ts';
import { D1InquiryStatusStore } from '../infrastructure/inquiry/d1-inquiry-status-store.ts';
import { D1MemberInquiryStore } from '../infrastructure/inquiry/d1-member-inquiry-store.ts';
import { EmailInquiryMailer } from '../infrastructure/inquiry/email-inquiry-mailer.ts';
import { InquiryAttachmentReadPolicy } from '../infrastructure/inquiry/inquiry-attachment-read-policy.ts';
import { MemberInquiryWithdrawalHandler } from '../infrastructure/inquiry/member-inquiry-withdrawal-handler.ts';
import { SentryInquiryIncidentReporter } from '../infrastructure/inquiry/sentry-inquiry-incident-reporter.ts';
import {
  insertAttachments,
  insertInquiryMessage,
  insertMemberInquiry,
  memberInquiryIdOf,
  messageIdOf,
  readMemberInquiryRows,
  resetInquiryTables,
} from '../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';
import * as mainModule from '../index.ts';
import type { CallerKind } from '../presentation/gateway/gateway-headers.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { MODULES } from './modules.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';

interface LoggedObject {
  readonly message: string;
  readonly [property: string]: unknown;
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const MAX_ATTACHMENT_BYTES = 20_971_520;

const OWNER = 1;
const OTHER = 2;
const ADMIN = 1;

const RETENTION_JOB_NAME = 'inquiry-chat.guest-inquiry-retention';

// 業務日付2026-11-02の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 2, 12, 21));
const DAILY_CRON = '21 12 * * *';

function createContainer() {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

async function issueUserSession(userIndex: number): Promise<string> {
  const issued = await createContainer()
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

function pdfOfLength(byteLength: number): Uint8Array {
  const header = pdfBytes();
  return concatBytes(header, new Uint8Array(byteLength - header.length));
}

function uploadAttachment(token: string, body: Uint8Array): Promise<Response> {
  return callInternal(
    'client',
    new Request(
      `${BASE_URL}/internal/media/uploads/${INQUIRY_ATTACHMENT_PURPOSE}`,
      {
        method: 'POST',
        headers: {
          [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
          [GATEWAY_HEADERS.sessionToken]: token,
          [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader('見積書.pdf'),
          'Content-Type': 'application/pdf',
          'Content-Length': String(body.length),
        },
        body,
      },
    ),
  );
}

async function uploadedFileIdOf(token: string): Promise<string> {
  const response = await uploadAttachment(token, pdfBytes());
  expect(response.status).toBe(201);
  const { data } = await response.json<{ readonly data: UploadedFile }>();
  return data.fileId;
}

function download(
  caller: CallerKind,
  token: string,
  fileId: string,
): Promise<Response> {
  return callInternal(
    caller,
    new Request(`${BASE_URL}/internal/media/files/${fileId}`, {
      headers: {
        [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        [GATEWAY_HEADERS.sessionToken]: token,
      },
    }),
  );
}

async function readDeletedAt(): Promise<
  readonly { readonly id: string; readonly deletedAt: Date | null }[]
> {
  const rows = await readMemberInquiryRows();
  return rows.map(({ id, deletedAt }) => ({ id, deletedAt }));
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearMediaState();
  await clearAdminTables();
  await clearIdentityTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーの問い合わせの束縛', () => {
  test.each([
    [
      'InquiryCategoryStore',
      INQUIRY_TYPES.InquiryCategoryStore,
      D1InquiryCategoryStore,
    ],
    ['GuestInquiryStore', INQUIRY_TYPES.GuestInquiryStore, D1GuestInquiryStore],
    [
      'MemberInquiryStore',
      INQUIRY_TYPES.MemberInquiryStore,
      D1MemberInquiryStore,
    ],
    [
      'InquiryStatusStore',
      INQUIRY_TYPES.InquiryStatusStore,
      D1InquiryStatusStore,
    ],
    [
      'InquiryAdminReader',
      INQUIRY_TYPES.InquiryAdminReader,
      D1InquiryAdminReader,
    ],
    ['InquirerProfiles', INQUIRY_TYPES.InquirerProfiles, D1InquirerProfiles],
    ['InquiryMailer', INQUIRY_TYPES.InquiryMailer, EmailInquiryMailer],
    [
      'InquiryIncidentReporter',
      INQUIRY_TYPES.InquiryIncidentReporter,
      SentryInquiryIncidentReporter,
    ],
    [
      'GuestInquiryRateLimit',
      INQUIRY_TYPES.GuestInquiryRateLimit,
      CounterGuestInquiryRateLimit,
    ],
    [
      'InquiryAttachmentBinder',
      INQUIRY_TYPES.InquiryAttachmentBinder,
      MediaInquiryAttachmentBinder,
    ],
    [
      'InquiryCategoryService',
      INQUIRY_TYPES.InquiryCategoryService,
      StoreInquiryCategoryService,
    ],
    [
      'GuestInquirySubmission',
      INQUIRY_TYPES.GuestInquirySubmission,
      StoreGuestInquirySubmission,
    ],
    [
      'MemberInquirySubmission',
      INQUIRY_TYPES.MemberInquirySubmission,
      StoreMemberInquirySubmission,
    ],
    [
      'InquiryChatService',
      INQUIRY_TYPES.InquiryChatService,
      StoreInquiryChatService,
    ],
    [
      'InquiryAdminService',
      INQUIRY_TYPES.InquiryAdminService,
      StoreInquiryAdminService,
    ],
    [
      'InquiryReplyService',
      INQUIRY_TYPES.InquiryReplyService,
      StoreInquiryReplyService,
    ],
    [
      'InquiryStatusService',
      INQUIRY_TYPES.InquiryStatusService,
      StoreInquiryStatusService,
    ],
    [
      'GuestInquiryRetentionJob',
      INQUIRY_TYPES.GuestInquiryRetentionJob,
      GuestInquiryRetentionJob,
    ],
    [
      'InquiryAttachmentReadPolicy',
      INQUIRY_TYPES.InquiryAttachmentReadPolicy,
      InquiryAttachmentReadPolicy,
    ],
    [
      'MemberInquiryWithdrawalHandler',
      INQUIRY_TYPES.MemberInquiryWithdrawalHandler,
      MemberInquiryWithdrawalHandler,
    ],
  ] as const)(
    '処理単位のコンテナで%sを実装へ解決する',
    (_name, identifier, implementation) => {
      expect(createContainer().get(identifier)).toBeInstanceOf(implementation);
    },
  );

  test('設定値は利用者側のオリジンから作り、処理単位の中で同じインスタンスを返す', () => {
    const container = createContainer();

    const settings = container.get<InquirySettings>(
      INQUIRY_TYPES.InquirySettings,
    );

    expect(settings).toEqual({ clientOrigin: env.CLIENT_SITE_ORIGIN });
    expect(container.get(INQUIRY_TYPES.InquirySettings)).toBe(settings);
  });
});

describe('問い合わせの添付のアップロードの用途', () => {
  test('添付の形式を20,971,520バイトまで利用者だけがファイルの保存先へアップロードできる用途として登録する', () => {
    const purpose = createContainer()
      .get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry)
      .find(INQUIRY_ATTACHMENT_PURPOSE);

    expect(purpose).toEqual({
      name: 'inquiry-attachment',
      storage: 'files',
      uploaderKinds: ['user'],
      allowedTypes: ATTACHMENT_MEDIA_TYPES,
      maxBytes: MAX_ATTACHMENT_BYTES,
    });
  });

  test('利用者が20,971,521バイトのファイルをアップロードすると、413で拒否し記録を作らない', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await uploadAttachment(
      token,
      pdfOfLength(MAX_ATTACHMENT_BYTES + 1),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'file_too_large' },
    });
    expect(await countRecords()).toBe(0);
  });

  test('利用者が20,971,520バイトのファイルをアップロードすると、201で受け付けて添付の用途で記録する', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await uploadAttachment(
      token,
      pdfOfLength(MAX_ATTACHMENT_BYTES),
    );

    expect(response.status).toBe(201);
    const { data } = await response.json<{ readonly data: UploadedFile }>();
    expect(await readRecord(data.fileId)).toMatchObject({
      purpose: INQUIRY_ATTACHMENT_PURPOSE,
      ownerKind: 'user',
      ownerId: userIdOf(OWNER),
      byteSize: MAX_ATTACHMENT_BYTES,
    });
  });
});

describe('問い合わせの添付の閲覧の方針', () => {
  test('本人のファイルは200でダウンロードでき、他人のファイルは404になる', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertUser(OTHER, { emailVerifiedAt: T0 });
    const ownerToken = await issueUserSession(OWNER);
    const otherToken = await issueUserSession(OTHER);
    const fileId = await uploadedFileIdOf(ownerToken);

    const own = await download('client', ownerToken, fileId);
    const others = await download('client', otherToken, fileId);

    expect(own.status).toBe(200);
    expect(others.status).toBe(404);
  });

  test('管理者は問い合わせに紐付いた添付だけを200でダウンロードでき、紐付いていないファイルは404になる', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertAdmin(ADMIN);
    const ownerToken = await issueUserSession(OWNER);
    const adminToken = (await issueAdminSession(adminIdOf(ADMIN))).token;
    const linkedFileId = await uploadedFileIdOf(ownerToken);
    const unlinkedFileId = await uploadedFileIdOf(ownerToken);
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
    await insertInquiryMessage(1, { inquiryId: memberInquiryIdOf(1) });
    await insertAttachments(messageIdOf(1), [linkedFileId]);

    const linked = await download('admin', adminToken, linkedFileId);
    const unlinked = await download('admin', adminToken, unlinkedFileId);

    expect(linked.status).toBe(200);
    expect(unlinked.status).toBe(404);
  });
});

describe('退会の同期の波及処理の登録', () => {
  test('退会の確定で、退会した利用者の問い合わせだけを同じ一括の書き込みで論理削除する', async () => {
    await insertUser(OWNER);
    await insertUser(OTHER);
    await insertMemberInquiry(
      1,
      { categoryId: INQUIRY_CATEGORY_OTHER_ID },
      OWNER,
    );
    await insertMemberInquiry(
      2,
      { categoryId: INQUIRY_CATEGORY_OTHER_ID },
      OTHER,
    );
    const at = new Date('2026-11-05T01:00:00.000Z');

    await createContainer()
      .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
      .commit({
        kind: 'withdraw',
        userId: userIdOf(OWNER),
        expectedVersion: 0,
        at,
      });

    expect(await readDeletedAt()).toEqual([
      { id: memberInquiryIdOf(1), deletedAt: at },
      { id: memberInquiryIdOf(2), deletedAt: null },
    ]);
  });

  test('読み取った版が古い退会は確定せず、問い合わせの論理削除も取り消される', async () => {
    await insertUser(OWNER);
    await insertMemberInquiry(
      1,
      { categoryId: INQUIRY_CATEGORY_OTHER_ID },
      OWNER,
    );

    await expect(
      createContainer()
        .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
        .commit({
          kind: 'withdraw',
          userId: userIdOf(OWNER),
          expectedVersion: 1,
          at: new Date('2026-11-05T01:00:00.000Z'),
        }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    expect(await readDeletedAt()).toEqual([
      { id: memberInquiryIdOf(1), deletedAt: null },
    ]);
  });
});

describe('未ログインの問い合わせの保持期間のジョブの登録', () => {
  test('4:21のジョブの一覧に、管理者のジョブの後・メディアのジョブの前の順序300で載る', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS).jobsFor(DAILY_CRON);
    const names = jobs.map(({ name }) => name);
    const index = names.indexOf(RETENTION_JOB_NAME);

    expect(jobs[index]).toMatchObject({
      name: RETENTION_JOB_NAME,
      order: 300,
      handler: INQUIRY_TYPES.GuestInquiryRetentionJob,
    });
    expect(names[index - 1]).toBe('admin-foundation.audit-log-retention');
    expect(names[index + 1]).toBe('media-pipeline.expired-file-erasure');
  });

  test('4:21の起動で、保持期間のジョブが束縛から解決されて成功する', async () => {
    const logs: LoggedObject[] = [];
    for (const method of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args[0] as LoggedObject);
      });
    }
    const scheduled = mainModule.default.scheduled;
    if (scheduled === undefined) {
      throw new Error('定期実行のハンドラーがエクスポートされていません');
    }
    const ctx = createExecutionContext();

    await scheduled(
      createScheduledController({
        cron: DAILY_CRON,
        scheduledTime: SCHEDULED_TIME.getTime(),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const summary = logs.find(
      ({ message }) => message === '定期実行を終えました',
    );
    const jobs = (summary?.['jobs'] ?? []) as readonly {
      readonly name: string;
      readonly result: string;
    }[];
    expect(jobs.find(({ name }) => name === RETENTION_JOB_NAME)).toMatchObject({
      result: 'succeeded',
    });
  });
});
