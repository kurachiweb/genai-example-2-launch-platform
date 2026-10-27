import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailCleanupCursors } from '../../../db/schema/email/email-cleanup-cursors.ts';
import { emailSendRecords } from '../../../db/schema/email/email-send-records.ts';
import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import type {
  EmailCleanupSummary,
  SuppressionMaintenance,
  UserAddressDirectory,
  UserAddressLookup,
} from '../../core/email/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { createCleanupCursorRepository } from './cleanup-cursor-repository.ts';
import { createSendRecordRepository } from './send-record-repository.ts';
import { createSuppressionMaintenance } from './suppression-maintenance.ts';
import { createSuppressionRepository } from './suppression-repository.ts';

const MILLISECONDS_PER_DAY = 86_400_000;

const NOW = new Date('2026-10-27T03:04:05.678Z');
const NEXT_DAY = new Date(NOW.getTime() + MILLISECONDS_PER_DAY);
const DAY_AFTER_NEXT = new Date(NOW.getTime() + 2 * MILLISECONDS_PER_DAY);
const ONE_YEAR_AGO = new Date(NOW.getTime() - 365 * MILLISECONDS_PER_DAY);
const FOURTEEN_DAYS_AGO = new Date(NOW.getTime() - 14 * MILLISECONDS_PER_DAY);
const RECENT = new Date(NOW.getTime() - MILLISECONDS_PER_DAY);
const LONG_AGO = new Date(ONE_YEAR_AGO.getTime() - MILLISECONDS_PER_DAY);

const KEYS_PER_PAGE = 90;
const MAX_PAGES = 20;

const UNLINKED_CURSOR_NAME = 'email-delivery.unlinked-suppressions';

// D1のバインド変数の上限(100)に収まるよう、1つの文で挿入する行数を抑える
const ROWS_PER_INSERT = 10;

const db = createDatabase(env.DB);

function clockAt(instant: Date): Clock {
  return { now: () => new Date(instant) };
}

function addressOf(index: number): string {
  return `recipient-${String(index).padStart(4, '0')}@recipient.example`;
}

function requestIdOf(index: number): string {
  return `01JBD8G7Q3Z6W0K8N5S2X4Y${String(index).padStart(3, '0')}`;
}

interface SuppressionRow {
  readonly address: string;
  readonly lastEventAt: Date;
  readonly expiresAt?: Date | null;
}

async function insertSuppressions(rows: readonly SuppressionRow[]) {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db.insert(emailSuppressions).values(
      rows.slice(start, start + ROWS_PER_INSERT).map((row) => ({
        address: row.address,
        lastReason: 'hard_bounce' as const,
        lastEventAt: row.lastEventAt,
        expiresAt: row.expiresAt ?? null,
        createdAt: row.lastEventAt,
        updatedAt: row.lastEventAt,
      })),
    );
  }
}

async function insertSendRecords(sentAts: readonly Date[]) {
  for (const [index, sentAt] of sentAts.entries()) {
    await db.insert(emailSendRecords).values({
      id: requestIdOf(index),
      kind: 'email-delivery.smoke',
      sentAt,
      createdAt: sentAt,
      updatedAt: sentAt,
    });
  }
}

async function readAddresses(): Promise<string[]> {
  const rows = await db
    .select({ address: emailSuppressions.address })
    .from(emailSuppressions)
    .orderBy(emailSuppressions.address);
  return rows.map((row) => row.address);
}

async function readSentAts(): Promise<Date[]> {
  const rows = await db
    .select({ sentAt: emailSendRecords.sentAt })
    .from(emailSendRecords)
    .orderBy(emailSendRecords.sentAt);
  return rows.map((row) => row.sentAt);
}

interface RecordingDirectory {
  readonly directory: UserAddressDirectory;
  readonly calls: (readonly string[])[];
}

function recordingDirectory(
  answer: (callIndex: number) => UserAddressLookup,
): RecordingDirectory {
  const calls: (readonly string[])[] = [];
  const directory: UserAddressDirectory = {
    findRegistered: (addresses) => {
      calls.push([...addresses]);
      return Promise.resolve(answer(calls.length - 1));
    },
  };
  return { directory, calls };
}

function availableDirectory(registered: readonly string[] = []) {
  return recordingDirectory(() => ({
    kind: 'available',
    registered: new Set(registered),
  }));
}

function unavailableDirectory() {
  return recordingDirectory(() => ({ kind: 'unavailable' }));
}

function createMaintenance(
  directory: UserAddressDirectory,
  instant: Date = NOW,
): SuppressionMaintenance {
  return createSuppressionMaintenance(
    createSuppressionRepository(db, clockAt(instant)),
    createSendRecordRepository(db),
    directory,
    createCleanupCursorRepository(db),
  );
}

async function readCursors() {
  return db
    .select({
      afterKey: emailCleanupCursors.afterKey,
      updatedAt: emailCleanupCursors.updatedAt,
    })
    .from(emailCleanupCursors);
}

async function saveCursor(afterKey: string): Promise<void> {
  await createCleanupCursorRepository(db).save(
    UNLINKED_CURSOR_NAME,
    afterKey,
    RECENT,
  );
}

interface ConsoleCall {
  readonly method: string;
  readonly args: unknown[];
}

function recordLogs(): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const recorder = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: recorder as unknown as Console,
  });
  return calls;
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await db.delete(emailSendRecords);
  await db.delete(emailCleanupCursors);
});

describe('createSuppressionMaintenance', () => {
  describe('deleteByAddress', () => {
    test('大文字小文字の違うアドレスでも照合キーの一致する記録を物理削除し、他の記録を残す', async () => {
      await insertSuppressions([
        { address: 'leaving@recipient.example', lastEventAt: RECENT },
        { address: 'staying@recipient.example', lastEventAt: RECENT },
      ]);
      const { directory, calls } = availableDirectory();

      await createMaintenance(directory).deleteByAddress(
        'Leaving@Recipient.Example',
      );

      expect(await readAddresses()).toEqual(['staying@recipient.example']);
      expect(calls).toEqual([]);
    });

    test('対象が無くても成功し、同じ削除を繰り返しても結果を変えない', async () => {
      await insertSuppressions([
        { address: 'leaving@recipient.example', lastEventAt: RECENT },
        { address: 'staying@recipient.example', lastEventAt: RECENT },
      ]);
      const maintenance = createMaintenance(availableDirectory().directory);

      await maintenance.deleteByAddress('leaving@recipient.example');
      await expect(
        maintenance.deleteByAddress('leaving@recipient.example'),
      ).resolves.toBeUndefined();
      await expect(
        maintenance.deleteByAddress('unknown@recipient.example'),
      ).resolves.toBeUndefined();

      expect(await readAddresses()).toEqual(['staying@recipient.example']);
      expect(await readCursors()).toEqual([]);
    });

    test('後始末の位置が削除するアドレスの照合キーなら位置を先頭へ戻し、次の後始末は先頭から確かめる', async () => {
      await insertSuppressions([
        { address: addressOf(0), lastEventAt: LONG_AGO },
        { address: addressOf(1), lastEventAt: LONG_AGO },
        { address: addressOf(2), lastEventAt: LONG_AGO },
      ]);
      await saveCursor(addressOf(1));
      const maintenance = createMaintenance(availableDirectory().directory);

      await maintenance.deleteByAddress(addressOf(1).toUpperCase());

      expect(await readCursors()).toEqual([]);
      expect(
        JSON.stringify(await db.select().from(emailCleanupCursors)),
      ).not.toContain(addressOf(1));

      const { directory, calls } = availableDirectory();
      await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls).toEqual([[addressOf(0), addressOf(2)]]);
    });

    test('後始末の位置が別の照合キーなら、退会時の削除は位置を変えない', async () => {
      await insertSuppressions([
        { address: 'leaving@recipient.example', lastEventAt: RECENT },
      ]);
      await saveCursor(addressOf(1));

      await createMaintenance(availableDirectory().directory).deleteByAddress(
        'leaving@recipient.example',
      );

      expect(await readCursors()).toEqual([
        { afterKey: addressOf(1), updatedAt: RECENT },
      ]);
    });
  });

  describe('runDailyCleanup', () => {
    test('期限の過ぎた抑止記録を削除し、期限内と期限なしの記録を残す', async () => {
      await insertSuppressions([
        {
          address: 'expired-before@recipient.example',
          lastEventAt: RECENT,
          expiresAt: new Date(NOW.getTime() - 1),
        },
        {
          address: 'expired-now@recipient.example',
          lastEventAt: RECENT,
          expiresAt: NOW,
        },
        {
          address: 'expires-later@recipient.example',
          lastEventAt: RECENT,
          expiresAt: new Date(NOW.getTime() + 1),
        },
        {
          address: 'permanent@recipient.example',
          lastEventAt: RECENT,
          expiresAt: null,
        },
      ]);

      const summary = await createMaintenance(
        availableDirectory().directory,
      ).runDailyCleanup(NOW);

      expect(summary).toEqual<EmailCleanupSummary>({
        expiredSuppressionsDeleted: 2,
        unlinkedSuppressionsDeleted: 0,
        sendRecordsDeleted: 0,
        unlinkedCheck: 'done',
      });
      expect(await readAddresses()).toEqual([
        'expires-later@recipient.example',
        'permanent@recipient.example',
      ]);
    });

    test('送信日時が14日より前の送信済みの記録を削除し、ちょうど14日前とそれより新しい記録を残す', async () => {
      await insertSendRecords([
        new Date(FOURTEEN_DAYS_AGO.getTime() - MILLISECONDS_PER_DAY),
        new Date(FOURTEEN_DAYS_AGO.getTime() - 1),
        FOURTEEN_DAYS_AGO,
        NOW,
      ]);

      const summary = await createMaintenance(
        availableDirectory().directory,
      ).runDailyCleanup(NOW);

      expect(summary.sendRecordsDeleted).toBe(2);
      expect(await readSentAts()).toEqual([FOURTEEN_DAYS_AGO, NOW]);
    });

    test('最後の契機から1年を過ぎ利用者に登録されていない記録だけを削除し、登録済みの記録と1年以内の記録を残す', async () => {
      await insertSuppressions([
        { address: 'unlinked-a@recipient.example', lastEventAt: LONG_AGO },
        {
          address: 'unlinked-b@recipient.example',
          lastEventAt: new Date(ONE_YEAR_AGO.getTime() - 1),
        },
        { address: 'registered@recipient.example', lastEventAt: LONG_AGO },
        {
          address: 'exactly-one-year@recipient.example',
          lastEventAt: ONE_YEAR_AGO,
        },
        { address: 'recent@recipient.example', lastEventAt: RECENT },
      ]);
      const { directory, calls } = availableDirectory([
        'registered@recipient.example',
      ]);

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(summary).toEqual<EmailCleanupSummary>({
        expiredSuppressionsDeleted: 0,
        unlinkedSuppressionsDeleted: 2,
        sendRecordsDeleted: 0,
        unlinkedCheck: 'done',
      });
      expect(calls).toEqual([
        [
          'registered@recipient.example',
          'unlinked-a@recipient.example',
          'unlinked-b@recipient.example',
        ],
      ]);
      expect(await readAddresses()).toEqual([
        'exactly-one-year@recipient.example',
        'recent@recipient.example',
        'registered@recipient.example',
      ]);
    });

    test('1年の判定は照合キーの昇順に90件ずつ、重ならないページで照会口へ渡す', async () => {
      const total = 200;
      const addresses = Array.from({ length: total }, (_, index) =>
        addressOf(index),
      );
      await insertSuppressions(
        addresses.map((address) => ({ address, lastEventAt: LONG_AGO })),
      );
      const registered = [addressOf(0), addressOf(89), addressOf(150)];
      const { directory, calls } = availableDirectory(registered);

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls.map((page) => page.length)).toEqual([
        KEYS_PER_PAGE,
        KEYS_PER_PAGE,
        total - 2 * KEYS_PER_PAGE,
      ]);
      expect(calls.flat()).toEqual(addresses);
      expect(summary.unlinkedSuppressionsDeleted).toBe(
        total - registered.length,
      );
      expect(await readAddresses()).toEqual(registered);
      expect(await readCursors()).toEqual([{ afterKey: null, updatedAt: NOW }]);
    });

    test('保存した位置より後ろの照合キーから確かめ、末尾に達したら位置を先頭へ戻す', async () => {
      const total = 10;
      await insertSuppressions(
        Array.from({ length: total }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      await saveCursor(addressOf(4));
      const { directory, calls } = availableDirectory();

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls).toEqual([
        [addressOf(5), addressOf(6), addressOf(7), addressOf(8), addressOf(9)],
      ]);
      expect(summary.unlinkedSuppressionsDeleted).toBe(5);
      expect(await readAddresses()).toEqual(
        Array.from({ length: 5 }, (_, index) => addressOf(index)),
      );
      expect(await readCursors()).toEqual([{ afterKey: null, updatedAt: NOW }]);
    });

    test('末尾のページがちょうど90件なら、続く空のページで末尾を確かめて位置を先頭へ戻す', async () => {
      await insertSuppressions(
        Array.from({ length: KEYS_PER_PAGE }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      const { directory, calls } = availableDirectory();

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls).toHaveLength(1);
      expect(summary.unlinkedSuppressionsDeleted).toBe(KEYS_PER_PAGE);
      expect(await readCursors()).toEqual([{ afterKey: null, updatedAt: NOW }]);
    });

    test('1回の後始末で照会口へ渡すのは最大20ページまでとし、最後に確かめた照合キーを保存して次の実行でその続きから削除する', async () => {
      const total = MAX_PAGES * KEYS_PER_PAGE + 1;
      await insertSuppressions(
        Array.from({ length: total }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      const today = availableDirectory();

      const first = await createMaintenance(today.directory).runDailyCleanup(
        NOW,
      );

      expect(today.calls).toHaveLength(MAX_PAGES);
      expect(first.unlinkedSuppressionsDeleted).toBe(MAX_PAGES * KEYS_PER_PAGE);
      expect(first.unlinkedCheck).toBe('done');
      expect(await readAddresses()).toEqual([addressOf(total - 1)]);
      expect(await readCursors()).toEqual([
        { afterKey: addressOf(total - 2), updatedAt: NOW },
      ]);

      const nextDay = availableDirectory();
      const second = await createMaintenance(
        nextDay.directory,
        NEXT_DAY,
      ).runDailyCleanup(NEXT_DAY);

      expect(nextDay.calls).toEqual([[addressOf(total - 1)]]);
      expect(second.unlinkedSuppressionsDeleted).toBe(1);
      expect(await readAddresses()).toEqual([]);
      expect(await readCursors()).toEqual([
        { afterKey: null, updatedAt: NEXT_DAY },
      ]);
    }, 30_000);

    test('照合キーの昇順で先頭の1,800件が1年を過ぎた登録済みの記録でも、翌日にその後ろの紐づかない記録を削除し、その次の日は先頭から確かめ直す', async () => {
      const registeredCount = MAX_PAGES * KEYS_PER_PAGE;
      const unlinkedCount = 5;
      const total = registeredCount + unlinkedCount;
      const addresses = Array.from({ length: total }, (_, index) =>
        addressOf(index),
      );
      await insertSuppressions(
        addresses.map((address) => ({ address, lastEventAt: LONG_AGO })),
      );
      const registered = addresses.slice(0, registeredCount);

      const today = availableDirectory(registered);
      const first = await createMaintenance(today.directory).runDailyCleanup(
        NOW,
      );

      expect(first.unlinkedSuppressionsDeleted).toBe(0);
      expect(today.calls.flat()).toEqual(registered);
      expect(await readCursors()).toEqual([
        { afterKey: addressOf(registeredCount - 1), updatedAt: NOW },
      ]);

      const nextDay = availableDirectory(registered);
      const second = await createMaintenance(
        nextDay.directory,
        NEXT_DAY,
      ).runDailyCleanup(NEXT_DAY);

      expect(nextDay.calls).toEqual([addresses.slice(registeredCount)]);
      expect(second.unlinkedSuppressionsDeleted).toBe(unlinkedCount);
      expect(await readAddresses()).toEqual(registered);
      expect(await readCursors()).toEqual([
        { afterKey: null, updatedAt: NEXT_DAY },
      ]);

      const dayAfterNext = availableDirectory(registered);
      const third = await createMaintenance(
        dayAfterNext.directory,
        DAY_AFTER_NEXT,
      ).runDailyCleanup(DAY_AFTER_NEXT);

      expect(dayAfterNext.calls[0]?.[0]).toBe(addressOf(0));
      expect(third.unlinkedSuppressionsDeleted).toBe(0);
      expect(await readAddresses()).toEqual(registered);
    }, 60_000);

    test('照会口が使えなければ1年の削除を行わず、期限切れと送信済みの記録の削除を続け、警告と要約に記す', async () => {
      await insertSuppressions([
        {
          address: 'expired@recipient.example',
          lastEventAt: RECENT,
          expiresAt: NOW,
        },
        { address: 'unlinked@recipient.example', lastEventAt: LONG_AGO },
      ]);
      await insertSendRecords([new Date(FOURTEEN_DAYS_AGO.getTime() - 1), NOW]);
      const logs = recordLogs();
      const { directory, calls } = unavailableDirectory();

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(summary).toEqual<EmailCleanupSummary>({
        expiredSuppressionsDeleted: 1,
        unlinkedSuppressionsDeleted: 0,
        sendRecordsDeleted: 1,
        unlinkedCheck: 'skipped-directory-unavailable',
      });
      expect(calls).toHaveLength(1);
      expect(await readAddresses()).toEqual(['unlinked@recipient.example']);
      expect(await readSentAts()).toEqual([NOW]);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.method).toBe('warn');
      expect(logs[0]?.args[0]).toMatchObject({
        level: 'warning',
        category: 'api.application.email-cleanup',
        unlinkedCheck: 'skipped-directory-unavailable',
      });
      expect(JSON.stringify(logs)).not.toContain('@recipient.example');
    });

    test('最初のページで照会口が使えなければ、保存した位置を進めも戻しもしない', async () => {
      await insertSuppressions(
        Array.from({ length: 10 }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      await saveCursor(addressOf(4));
      recordLogs();
      const { directory, calls } = unavailableDirectory();

      await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls).toEqual([
        [addressOf(5), addressOf(6), addressOf(7), addressOf(8), addressOf(9)],
      ]);
      expect(await readCursors()).toEqual([
        { afterKey: addressOf(4), updatedAt: RECENT },
      ]);
    });

    test('照会口が途中のページで使えなくなれば以降のページを照会せず、それまでの削除を要約に記し、確かめ終えたページの最後まで位置を進める', async () => {
      const total = KEYS_PER_PAGE + 10;
      await insertSuppressions(
        Array.from({ length: total }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      recordLogs();
      const { directory, calls } = recordingDirectory((callIndex) =>
        callIndex === 0
          ? { kind: 'available', registered: new Set() }
          : { kind: 'unavailable' },
      );

      const summary = await createMaintenance(directory).runDailyCleanup(NOW);

      expect(calls).toHaveLength(2);
      expect(summary.unlinkedSuppressionsDeleted).toBe(KEYS_PER_PAGE);
      expect(summary.unlinkedCheck).toBe('skipped-directory-unavailable');
      expect(await readAddresses()).toHaveLength(total - KEYS_PER_PAGE);
      expect(await readCursors()).toEqual([
        { afterKey: addressOf(KEYS_PER_PAGE - 1), updatedAt: NOW },
      ]);

      const nextDay = availableDirectory();
      const second = await createMaintenance(
        nextDay.directory,
        NEXT_DAY,
      ).runDailyCleanup(NEXT_DAY);

      expect(nextDay.calls).toEqual([
        Array.from({ length: 10 }, (_, index) =>
          addressOf(KEYS_PER_PAGE + index),
        ),
      ]);
      expect(second.unlinkedSuppressionsDeleted).toBe(10);
      expect(await readAddresses()).toEqual([]);
    });

    test('同じ日に繰り返し実行しても、確かめる照合キーは保存した位置から進み、登録済みの記録を削除せず、一巡した後は何も削除しない', async () => {
      await insertSuppressions(
        Array.from({ length: 10 }, (_, index) => ({
          address: addressOf(index),
          lastEventAt: LONG_AGO,
        })),
      );
      await saveCursor(addressOf(4));
      const registered = [addressOf(2), addressOf(7)];
      const { directory, calls } = availableDirectory(registered);
      const maintenance = createMaintenance(directory);

      const summaries = [
        await maintenance.runDailyCleanup(NOW),
        await maintenance.runDailyCleanup(NOW),
        await maintenance.runDailyCleanup(NOW),
      ];

      expect(calls).toEqual([
        [addressOf(5), addressOf(6), addressOf(7), addressOf(8), addressOf(9)],
        [
          addressOf(0),
          addressOf(1),
          addressOf(2),
          addressOf(3),
          addressOf(4),
          addressOf(7),
        ],
        registered,
      ]);
      expect(
        summaries.map((summary) => summary.unlinkedSuppressionsDeleted),
      ).toEqual([4, 4, 0]);
      expect(await readAddresses()).toEqual(registered);
      expect(await readCursors()).toEqual([{ afterKey: null, updatedAt: NOW }]);
    });

    test.each([
      ['使える', () => availableDirectory(['registered@recipient.example'])],
      ['使えない', unavailableDirectory],
    ])(
      '照会口が%s場合、同じ日の2回目の実行は何も削除せず、同じ確認の結果を返す',
      async (_label, createDirectory) => {
        recordLogs();
        await insertSuppressions([
          {
            address: 'expired@recipient.example',
            lastEventAt: RECENT,
            expiresAt: NOW,
          },
          { address: 'unlinked@recipient.example', lastEventAt: LONG_AGO },
          { address: 'registered@recipient.example', lastEventAt: LONG_AGO },
          { address: 'recent@recipient.example', lastEventAt: RECENT },
        ]);
        await insertSendRecords([
          new Date(FOURTEEN_DAYS_AGO.getTime() - 1),
          NOW,
        ]);
        const maintenance = createMaintenance(createDirectory().directory);

        const first = await maintenance.runDailyCleanup(NOW);
        const addressesAfterFirst = await readAddresses();
        const sentAtsAfterFirst = await readSentAts();
        const cursorsAfterFirst = await readCursors();
        const second = await maintenance.runDailyCleanup(NOW);

        expect(first.expiredSuppressionsDeleted).toBe(1);
        expect(first.sendRecordsDeleted).toBe(1);
        expect(second).toEqual<EmailCleanupSummary>({
          expiredSuppressionsDeleted: 0,
          unlinkedSuppressionsDeleted: 0,
          sendRecordsDeleted: 0,
          unlinkedCheck: first.unlinkedCheck,
        });
        expect(await readAddresses()).toEqual(addressesAfterFirst);
        expect(await readSentAts()).toEqual(sentAtsAfterFirst);
        expect(await readCursors()).toEqual(cursorsAfterFirst);
      },
    );
  });
});
