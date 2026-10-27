import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
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
import { createSendRecordRepository } from './send-record-repository.ts';
import { createSuppressionMaintenance } from './suppression-maintenance.ts';
import { createSuppressionRepository } from './suppression-repository.ts';

const MILLISECONDS_PER_DAY = 86_400_000;

const NOW = new Date('2026-10-27T03:04:05.678Z');
const NEXT_DAY = new Date(NOW.getTime() + MILLISECONDS_PER_DAY);
const ONE_YEAR_AGO = new Date(NOW.getTime() - 365 * MILLISECONDS_PER_DAY);
const FOURTEEN_DAYS_AGO = new Date(NOW.getTime() - 14 * MILLISECONDS_PER_DAY);
const RECENT = new Date(NOW.getTime() - MILLISECONDS_PER_DAY);
const LONG_AGO = new Date(ONE_YEAR_AGO.getTime() - MILLISECONDS_PER_DAY);

const KEYS_PER_PAGE = 90;
const MAX_PAGES = 20;

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
): SuppressionMaintenance {
  return createSuppressionMaintenance(
    createSuppressionRepository(db, clockAt(NOW)),
    createSendRecordRepository(db),
    directory,
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
    });

    test('1回の後始末で照会口へ渡すのは最大20ページまでとし、残りは次の実行で削除する', async () => {
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

      const nextDay = availableDirectory();
      const second = await createSuppressionMaintenance(
        createSuppressionRepository(db, clockAt(NEXT_DAY)),
        createSendRecordRepository(db),
        nextDay.directory,
      ).runDailyCleanup(NEXT_DAY);

      expect(nextDay.calls).toEqual([[addressOf(total - 1)]]);
      expect(second.unlinkedSuppressionsDeleted).toBe(1);
      expect(await readAddresses()).toEqual([]);
    }, 30_000);

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

    test('照会口が途中のページで使えなくなれば以降のページを照会せず、それまでの削除を要約に記す', async () => {
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
      },
    );
  });
});
