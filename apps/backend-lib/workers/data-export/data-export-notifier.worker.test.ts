import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { DATA_EXPORT_FAILURE_KINDS } from '../../../common-lib/data-export/data-export-rules.ts';
import type {
  DataExportNotifier,
  DataExportStore,
} from '../../core/data-export/ports.ts';
import {
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
} from '../../core/email/kinds/data-export.ts';
import type { EmailSender, EmailSendRequest } from '../../core/email/ports.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import { D1UserContactDirectory } from '../identity/d1-user-contact-directory.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { D1DataExportStore } from './d1-data-export-store.ts';
import { EmailDataExportNotifier } from './data-export-notifier.ts';
import {
  clearDataExportState,
  daysAfter,
  db,
  exportIdOf,
  expiredColumnsOf,
  failedColumnsOf,
  insertUsers,
  minutesAfter,
  queuedRowOf,
  readyColumnsOf,
  seed,
  T0,
  userIdOf,
} from './testing/data-export-fixtures.ts';

const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

const PAGE_URL = `${CLIENT_SITE_ORIGIN}/settings/export`;

const CONTACT_URL = `${CLIENT_SITE_ORIGIN}/contact`;

const NOTIFIER_CATEGORY = 'api.infrastructure.data-export';

const EXPORT = 1;

const OWNER = 1;

const NICKNAME = '利用者1';

const EMAIL = 'exporter1@mail.example';

const store: DataExportStore = new D1DataExportStore(db);

interface RecordingSender {
  readonly sender: EmailSender;
  readonly requests: EmailSendRequest<unknown>[];
  readonly delivered: EmailSendRequest<unknown>[];
}

// 送信の基盤と同じく、同じ種別で同じ冪等のキーの2回目は送らない
function createSender(failure?: Error): RecordingSender {
  const requests: EmailSendRequest<unknown>[] = [];
  const delivered: EmailSendRequest<unknown>[] = [];
  const seen = new Set<string>();
  return {
    requests,
    delivered,
    sender: {
      send: <TInput>(request: EmailSendRequest<TInput>) => {
        requests.push(request);
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        request.kind.inputSchema.parse(request.input);
        const dedupeKey = `${request.kind.name}:${request.idempotencyKey ?? ''}`;
        if (request.idempotencyKey === undefined || !seen.has(dedupeKey)) {
          delivered.push(request);
        }
        seen.add(dedupeKey);
        return Promise.resolve(
          `01JC0EMA11${String(requests.length).padStart(16, '0')}`,
        );
      },
    },
  };
}

function createNotifier(
  sender: EmailSender,
  notices: DataExportStore = store,
  clientSiteOrigin: string = CLIENT_SITE_ORIGIN,
  appName: 'api' | 'event' = 'api',
): DataExportNotifier {
  return new EmailDataExportNotifier(
    notices,
    new D1UserContactDirectory(db),
    sender,
    { ...env, CLIENT_SITE_ORIGIN: clientSiteOrigin },
    appName,
  );
}

function storeWith(overrides: Partial<DataExportStore>): DataExportStore {
  return Object.assign(Object.create(store) as DataExportStore, overrides);
}

function storeFailingAdvanceOnce(): DataExportStore {
  let failed = false;
  return storeWith({
    advanceNotice: (input) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error('通知の状態の前進に失敗'));
      }
      return store.advanceNotice(input);
    },
  });
}

async function noticeStatusOf(index: number): Promise<string | undefined> {
  return (await store.find(exportIdOf(index)))?.noticeStatus;
}

async function seedReady(
  columns: Parameters<typeof queuedRowOf>[2] = {},
): Promise<void> {
  await seed([
    queuedRowOf(EXPORT, OWNER, {
      ...readyColumnsOf(daysAfter(7)),
      ...columns,
    }),
  ]);
}

async function seedFailed(
  columns: Parameters<typeof queuedRowOf>[2] = {},
): Promise<void> {
  await seed([
    queuedRowOf(EXPORT, OWNER, {
      ...failedColumnsOf(),
      noticeStatus: 'pending',
      ...columns,
    }),
  ]);
}

let logs: LogObject[] = [];

beforeEach(async () => {
  logs = recordLogs();
  installRecordingSentry();
  await clearDataExportState();
  await insertUsers([OWNER]);
});

afterEach(() => {
  resetObservability();
});

describe('完了の通知', () => {
  test('完了の種別のメールを、ニックネームと日時とページのURLを入力にして登録のメールアドレスへ1回だけ依頼し、依頼済みにする', async () => {
    await seedReady();
    const { sender, requests } = createSender();

    const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

    expect(outcome).toBe('requested');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      kind: DATA_EXPORT_ARCHIVE_READY_EMAIL,
      to: EMAIL,
      input: {
        nickname: NICKNAME,
        requestedAt: minutesAfter(EXPORT).toISOString(),
        expiresAt: daysAfter(7).toISOString(),
        pageUrl: PAGE_URL,
      },
      idempotencyKey: exportIdOf(EXPORT),
    });
    expect(await noticeStatusOf(EXPORT)).toBe('requested');
  });

  test('停止中の利用者にも送る', async () => {
    await seedReady();
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: T0 })
      .where(eq(users.id, userIdOf(OWNER)));
    const { sender, requests } = createSender();

    const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

    expect(outcome).toBe('requested');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.to).toBe(EMAIL);
  });

  test('期限切れになった記録の依頼待ちは、リンクの先が無いため送らずに送らない状態にする', async () => {
    await seed([
      queuedRowOf(EXPORT, OWNER, {
        ...expiredColumnsOf(),
        noticeStatus: 'pending',
      }),
    ]);
    const { sender, requests } = createSender();

    const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

    expect(outcome).toBe('skipped');
    expect(requests).toEqual([]);
    expect(await noticeStatusOf(EXPORT)).toBe('skipped');
  });
});

describe('列が欠けた記録', () => {
  test.each([
    ['期限の無い完了', { status: 'ready', expiresAt: null }],
    ['種別の無い失敗', { status: 'failed', failureKind: null }],
  ] as const)(
    '%sの依頼待ちは、送り直しても直らないため送らずに送らない状態にする',
    async (_label, columns) => {
      await seedReady();
      const incomplete = storeWith({
        find: async (id) => {
          const record = await store.find(id);
          return record === undefined ? undefined : { ...record, ...columns };
        },
      });
      const { sender, requests } = createSender();

      const outcome = await createNotifier(sender, incomplete).notify(
        exportIdOf(EXPORT),
      );

      expect(outcome).toBe('skipped');
      expect(requests).toEqual([]);
      expect(await noticeStatusOf(EXPORT)).toBe('skipped');
    },
  );
});

describe('失敗の通知', () => {
  test.each(DATA_EXPORT_FAILURE_KINDS)(
    '失敗の種別のメールを、理由%sとページと問い合わせのURLを入力にして1回だけ依頼し、依頼済みにする',
    async (failureKind) => {
      await seedFailed({ failureKind });
      const { sender, requests } = createSender();

      const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

      expect(outcome).toBe('requested');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({
        kind: DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
        to: EMAIL,
        input: {
          nickname: NICKNAME,
          requestedAt: minutesAfter(EXPORT).toISOString(),
          reason: failureKind,
          pageUrl: PAGE_URL,
          contactUrl: CONTACT_URL,
        },
        idempotencyKey: exportIdOf(EXPORT),
      });
      expect(await noticeStatusOf(EXPORT)).toBe('requested');
    },
  );
});

describe('依頼しない場合', () => {
  test.each(['none', 'requested', 'skipped'] as const)(
    '通知の状態が%sなら依頼せずnot_pendingを返し、状態を変えない',
    async (noticeStatus) => {
      await seedReady({ noticeStatus });
      const { sender, requests } = createSender();

      const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

      expect(outcome).toBe('not_pending');
      expect(requests).toEqual([]);
      expect(await noticeStatusOf(EXPORT)).toBe(noticeStatus);
    },
  );

  test('記録が無ければ依頼せずnot_pendingを返す', async () => {
    const { sender, requests } = createSender();

    const outcome = await createNotifier(sender).notify(exportIdOf(99));

    expect(outcome).toBe('not_pending');
    expect(requests).toEqual([]);
  });

  test('依頼を終えた記録を続けて通知しても、依頼は1回だけである', async () => {
    await seedReady();
    const { sender, requests } = createSender();
    const notifier = createNotifier(sender);

    const first = await notifier.notify(exportIdOf(EXPORT));
    const second = await notifier.notify(exportIdOf(EXPORT));

    expect([first, second]).toEqual(['requested', 'not_pending']);
    expect(requests).toHaveLength(1);
  });

  test('宛先が退会済みなら送らずに送らない状態にし、要求のIDだけをinfoで記録する', async () => {
    await seedReady();
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, userIdOf(OWNER)));
    const { sender, requests } = createSender();

    const outcome = await createNotifier(sender).notify(exportIdOf(EXPORT));

    expect(outcome).toBe('skipped');
    expect(requests).toEqual([]);
    expect(await noticeStatusOf(EXPORT)).toBe('skipped');
    const skipped = logs.filter((log) => log.level === 'info');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      category: NOTIFIER_CATEGORY,
      exportId: exportIdOf(EXPORT),
    });
  });
});

describe('失敗と送り直し', () => {
  test('メールの依頼に失敗したら例外のまま投げ、依頼待ちのまま残して、次の通知で送る', async () => {
    await seedReady();
    const failure = new Error('送信の基盤が一時的に使えない');
    const failing = createSender(failure);

    await expect(
      createNotifier(failing.sender).notify(exportIdOf(EXPORT)),
    ).rejects.toBe(failure);
    expect(await noticeStatusOf(EXPORT)).toBe('pending');

    const recovered = createSender();
    const outcome = await createNotifier(recovered.sender).notify(
      exportIdOf(EXPORT),
    );

    expect(outcome).toBe('requested');
    expect(recovered.delivered).toHaveLength(1);
    expect(await noticeStatusOf(EXPORT)).toBe('requested');
  });

  test('依頼の後に通知の状態の前進が失敗して再び通知しても、同じ冪等のキーで依頼するため2通目は送られない', async () => {
    await seedFailed();
    const { sender, requests, delivered } = createSender();
    const notifier = createNotifier(sender, storeFailingAdvanceOnce());

    await expect(notifier.notify(exportIdOf(EXPORT))).rejects.toThrow(
      '通知の状態の前進に失敗',
    );
    expect(await noticeStatusOf(EXPORT)).toBe('pending');
    const outcome = await notifier.notify(exportIdOf(EXPORT));

    expect(outcome).toBe('requested');
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.idempotencyKey)).toEqual([
      exportIdOf(EXPORT),
      exportIdOf(EXPORT),
    ]);
    expect(delivered).toHaveLength(1);
    expect(await noticeStatusOf(EXPORT)).toBe('requested');
  });

  test('依頼の間に他の処理が通知の状態を前進させていたらnot_pendingを返す', async () => {
    await seedReady();
    const { sender } = createSender();
    const racing = storeWith({
      advanceNotice: async (input) => {
        await store.advanceNotice(input);
        return false;
      },
    });

    const outcome = await createNotifier(sender, racing).notify(
      exportIdOf(EXPORT),
    );

    expect(outcome).toBe('not_pending');
  });
});

describe('URLの組み立て', () => {
  test.each([
    ['末尾にスラッシュのあるオリジン', 'https://client.example/'],
    ['ポートを含むオリジン', 'https://client.example:8443'],
  ])('%sから、ページと問い合わせのURLを組み立てる', async (_label, origin) => {
    await seedFailed();
    const { sender, requests } = createSender();

    await createNotifier(sender, store, origin).notify(exportIdOf(EXPORT));

    const input = requests[0]?.input as {
      pageUrl: string;
      contactUrl: string;
    };
    expect(input.pageUrl).toBe(new URL('/settings/export', origin).href);
    expect(input.contactUrl).toBe(new URL('/contact', origin).href);
  });
});

describe('ログ', () => {
  test('アプリ名をカテゴリの先頭にし、メールアドレスとニックネームを含めない', async () => {
    await seed([
      queuedRowOf(EXPORT, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
      }),
      queuedRowOf(2, OWNER, { ...failedColumnsOf(), noticeStatus: 'pending' }),
    ]);
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, userIdOf(OWNER)));
    const { sender } = createSender();
    resetObservability();
    logs = recordLogs('event');
    const notifier = createNotifier(sender, store, CLIENT_SITE_ORIGIN, 'event');

    await notifier.notify(exportIdOf(EXPORT));
    await notifier.notify(exportIdOf(2));

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.map((log) => log.category)).toEqual([
      'event.infrastructure.data-export',
      'event.infrastructure.data-export',
    ]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(NICKNAME);
    expect(serialized).not.toContain('exporter1');
  });
});
