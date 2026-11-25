import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { dataExports } from '../../db/schema/data-export/data-exports.ts';
import { users } from '../../db/schema/identity/users.ts';
import { GENERATION_MAX_ATTEMPTS } from '../../lib/core/data-export/data-export-messages.ts';
import {
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
} from '../../lib/core/email/kinds/data-export.ts';
import { exportIdOf } from '../../lib/workers/data-export/testing/data-export-fixtures.ts';
import { userIdOf } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  archiveKeyOf,
  BUSY_DEFER_SECONDS,
  deadLetterCount,
  deferredGenerationDelays,
  dispatch,
  envInterruptingAfterUpload,
  EXPORT,
  failingUploadEnv,
  generateEnvelope,
  HOUR_MS,
  installQueueSpies,
  listArchiveKeys,
  OWNER_EMAIL,
  seedQueuedExport,
  sentEmails,
  watchdogEnvelope,
} from './testing/data-export-archive-harness.ts';
import {
  at,
  clearAll,
  db,
  emptyBuckets,
  exportRowOf,
  OWNER,
  readExport,
  seedOwnerData,
} from './testing/data-export-archive-seed.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const COMPLETED = { acked: true, retried: false } as const;

const RETRIED = { acked: false, retried: true } as const;

async function withdrawOwner(): Promise<void> {
  await db
    .update(users)
    .set({ deletedAt: at(20_000) })
    .where(eq(users.id, userIdOf(OWNER)));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearAll();
  await emptyBuckets();
  await seedOwnerData();
  installQueueSpies();
});

afterEach(() => {
  expect(deadLetterCount()).toBe(0);
  vi.restoreAllMocks();
});

describe('重複した配信', () => {
  test('完了した要求への同じメッセージの再配信は何も作らず、ZIPは1つ、完了のメールの依頼は1回のままになる', async () => {
    await seedQueuedExport();
    await dispatch(generateEnvelope());
    const before = await readExport(EXPORT);

    await expect(dispatch(generateEnvelope())).resolves.toStrictEqual(
      COMPLETED,
    );

    expect(await listArchiveKeys()).toStrictEqual([archiveKeyOf()]);
    expect(await readExport(EXPORT)).toStrictEqual(before);
    expect(sentEmails()).toHaveLength(1);
  });

  test('同じ要求のメッセージを同時に処理しても、ZIPは1つだけで、完了のメールの依頼も1回だけである', async () => {
    await seedQueuedExport();

    await Promise.all([
      dispatch(generateEnvelope()),
      dispatch(generateEnvelope()),
    ]);

    expect(await listArchiveKeys()).toStrictEqual([archiveKeyOf()]);
    expect(await readExport(EXPORT)).toMatchObject({
      status: 'ready',
      attempts: 1,
    });
    expect(sentEmails()).toStrictEqual([
      {
        kind: DATA_EXPORT_ARCHIVE_READY_EMAIL.name,
        to: OWNER_EMAIL,
        idempotencyKey: exportIdOf(EXPORT),
      },
    ]);
  });

  test('別の実行が生成中のときは、何も作らず遅延付きで送り直す', async () => {
    await db.insert(dataExports).values(
      exportRowOf(EXPORT, OWNER, {
        status: 'generating',
        runToken: 'other-run',
        leaseExpiresAt: new Date(Date.now() + HOUR_MS),
        attempts: 1,
      }),
    );

    await expect(dispatch(generateEnvelope())).resolves.toStrictEqual(
      COMPLETED,
    );

    expect(deferredGenerationDelays()).toStrictEqual([BUSY_DEFER_SECONDS]);
    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(await readExport(EXPORT)).toMatchObject({
      status: 'generating',
      runToken: 'other-run',
    });
    expect(sentEmails()).toStrictEqual([]);
  });
});

describe('見張りによる失敗', () => {
  test('生成の完了の前に見張りが失敗にした要求は、完了の時点でZIPを削除し、完了のメールを依頼しない', async () => {
    await seedQueuedExport();
    const interrupted = envInterruptingAfterUpload(async () => {
      await dispatch(watchdogEnvelope());
    });

    await expect(
      dispatch(generateEnvelope(), { runtimeEnv: interrupted }),
    ).resolves.toStrictEqual(COMPLETED);

    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      failureKind: 'error',
    });
    expect(sentEmails().map(({ kind }) => kind)).toStrictEqual([
      DATA_EXPORT_ARCHIVE_FAILED_EMAIL.name,
    ]);
  });

  test('作成中の要求を見張りが失敗にして失敗のメールを1回だけ依頼し、2回目の見張りは何もしない', async () => {
    await seedQueuedExport();

    await dispatch(watchdogEnvelope());
    await dispatch(watchdogEnvelope());

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      failureKind: 'error',
      noticeStatus: 'requested',
    });
    expect(sentEmails()).toStrictEqual([
      {
        kind: DATA_EXPORT_ARCHIVE_FAILED_EMAIL.name,
        to: OWNER_EMAIL,
        idempotencyKey: exportIdOf(EXPORT),
      },
    ]);
  });

  test('完了した要求は見張りでは変わらない', async () => {
    await seedQueuedExport();
    await dispatch(generateEnvelope());

    await dispatch(watchdogEnvelope());

    expect(await readExport(EXPORT)).toMatchObject({ status: 'ready' });
    expect(await listArchiveKeys()).toStrictEqual([archiveKeyOf()]);
    expect(sentEmails()).toHaveLength(1);
  });
});

describe('生成の失敗と再試行', () => {
  test('アップロードを開始できずに1回目と2回目が失敗したときは、再試行に回し、要求は作成中のまま、ZIPもアップロードも残さない', async () => {
    await seedQueuedExport();

    for (const attempts of [1, 2]) {
      await expect(
        dispatch(generateEnvelope(), {
          attempts,
          runtimeEnv: failingUploadEnv(),
        }),
      ).resolves.toStrictEqual(RETRIED);
    }

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'generating',
      attempts: 2,
      runToken: null,
      leaseExpiresAt: null,
    });
    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(sentEmails()).toStrictEqual([]);
  });

  test('再試行で成功すれば完了し、完了のメールは1回だけ依頼する', async () => {
    await seedQueuedExport();
    await dispatch(generateEnvelope(), {
      attempts: 1,
      runtimeEnv: failingUploadEnv(),
    });

    await dispatch(generateEnvelope(), { attempts: 2 });

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'ready',
      attempts: 2,
    });
    expect(sentEmails().map(({ kind }) => kind)).toStrictEqual([
      DATA_EXPORT_ARCHIVE_READY_EMAIL.name,
    ]);
  });

  test('3回目の失敗で要求を失敗と確定し、失敗のメールを依頼して終える', async () => {
    await seedQueuedExport();

    await expect(
      dispatch(generateEnvelope(), {
        attempts: GENERATION_MAX_ATTEMPTS,
        runtimeEnv: failingUploadEnv(),
      }),
    ).resolves.toStrictEqual(COMPLETED);

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      failureKind: 'error',
      noticeStatus: 'requested',
    });
    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(sentEmails()).toStrictEqual([
      {
        kind: DATA_EXPORT_ARCHIVE_FAILED_EMAIL.name,
        to: OWNER_EMAIL,
        idempotencyKey: exportIdOf(EXPORT),
      },
    ]);
  });

  test('3回目の失敗でメールの依頼に失敗しても失敗は取り消さず、通知は依頼待ちのまま残す', async () => {
    await seedQueuedExport();
    vi.spyOn(env.JOBS_QUEUE, 'send').mockRejectedValue(
      new Error('Queueの障害'),
    );

    await expect(
      dispatch(generateEnvelope(), {
        attempts: GENERATION_MAX_ATTEMPTS,
        runtimeEnv: failingUploadEnv(),
      }),
    ).resolves.toStrictEqual(COMPLETED);

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      failureKind: 'error',
      noticeStatus: 'pending',
    });
  });
});

describe('退会済みの利用者の要求', () => {
  test('生成の開始の時点で退会済みなら、ZIPを作らず、失敗にして通知を依頼しない', async () => {
    await withdrawOwner();
    await seedQueuedExport();

    await expect(dispatch(generateEnvelope())).resolves.toStrictEqual(
      COMPLETED,
    );

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      noticeStatus: 'skipped',
    });
    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(sentEmails()).toStrictEqual([]);
  });

  test('生成の途中で退会した場合は、作ったZIPを削除し、失敗にして通知を依頼しない', async () => {
    await seedQueuedExport();
    const interrupted = envInterruptingAfterUpload(withdrawOwner);

    await expect(
      dispatch(generateEnvelope(), { runtimeEnv: interrupted }),
    ).resolves.toStrictEqual(COMPLETED);

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      noticeStatus: 'skipped',
    });
    expect(await listArchiveKeys()).toStrictEqual([]);
    expect(sentEmails()).toStrictEqual([]);
  });

  test('退会済みの利用者の要求を見張りが失敗にしても、宛先が無いため通知を依頼しない', async () => {
    await withdrawOwner();
    await seedQueuedExport();

    await dispatch(watchdogEnvelope());

    expect(await readExport(EXPORT)).toMatchObject({
      status: 'failed',
      noticeStatus: 'skipped',
    });
    expect(sentEmails()).toStrictEqual([]);
  });
});
