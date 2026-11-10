import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { qualifierPairings } from '../../db/schema/match/qualifier-pairings.ts';
import { QUALIFIER_SCHEDULE } from '../../lib/core/match/match-model.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
  type BusinessTimeOfDay,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { readMatchRows } from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  clearMatchTables,
  MATCH_DATE,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  MatchKickoffJob,
  MatchSettlementJob,
  QualifierPairingJob,
} from '../application/match/match-jobs.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';

interface LoggedObject {
  readonly level: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

const OWNER = 1;
const DATE = parseBusinessDate(MATCH_DATE);
const PREVIOUS_DATE = parseBusinessDate('2026-11-19');
const PAIRING_LATE_MESSAGE =
  '前日に完了していなかった予選のペアリングを、開始の前に行いました';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

async function runScheduled(
  date: typeof DATE,
  time: BusinessTimeOfDay,
): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: toUtcCronExpression(time),
      scheduledTime: fromBusinessDateTime(date, time).getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

function jobResults(logs: readonly LoggedObject[]): JobSummary[] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .flatMap((summary) => (summary['jobs'] ?? []) as readonly JobSummary[])
    .map(({ name, result }) => ({ name, result }));
}

async function readDayStatus(): Promise<string | undefined> {
  const [row] = await db
    .select({ status: qualifierPairings.status })
    .from(qualifierPairings)
    .where(eq(qualifierPairings.matchDate, MATCH_DATE));
  return row?.status;
}

beforeEach(async () => {
  await clearMatchTables();
  await insertUser(OWNER);
  await insertProducts([1, 2, 3], OWNER);
  await insertLaunches(
    [1, 2, 3].map((index) => ({
      index,
      productIndex: index,
      columns: { launchDate: MATCH_DATE },
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのマッチのモジュールの日次のジョブの束縛', () => {
  test('処理単位のコンテナから、確定・ペアリング・開始のジョブをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(container.get(MATCH_TYPES.MatchSettlementJob)).toBeInstanceOf(
      MatchSettlementJob,
    );
    expect(container.get(MATCH_TYPES.QualifierPairingJob)).toBeInstanceOf(
      QualifierPairingJob,
    );
    expect(container.get(MATCH_TYPES.MatchKickoffJob)).toBeInstanceOf(
      MatchKickoffJob,
    );
  });

  test('23:40と23:45の起動で前日の業務日付の翌日の予選を組み、0:00の起動はペアリングの遅れを報告しない', async () => {
    const logs = recordConsole();

    await runScheduled(PREVIOUS_DATE, QUALIFIER_SCHEDULE.fullTime);
    await runScheduled(PREVIOUS_DATE, QUALIFIER_SCHEDULE.pairing);

    expect((await readMatchRows()).map(({ matchDate }) => matchDate)).toEqual([
      MATCH_DATE,
      MATCH_DATE,
    ]);
    expect(await readDayStatus()).toBe('completed');

    await runScheduled(DATE, QUALIFIER_SCHEDULE.kickoff);

    expect(await readMatchRows()).toHaveLength(2);
    expect(logs.some(({ message }) => message === PAIRING_LATE_MESSAGE)).toBe(
      false,
    );
    expect(jobResults(logs)).toEqual(
      expect.arrayContaining([
        { name: 'match-engine.match-settlement', result: 'succeeded' },
        { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
        { name: 'match-engine.match-kickoff', result: 'succeeded' },
      ]),
    );
  });

  test('23:45のペアリングが行われていなければ、0:00の起動が当日の予選を組んで遅れを報告する', async () => {
    const logs = recordConsole();

    await runScheduled(DATE, QUALIFIER_SCHEDULE.kickoff);

    expect(await readMatchRows()).toHaveLength(2);
    expect(await readDayStatus()).toBe('completed');
    expect(
      logs.find(({ message }) => message === PAIRING_LATE_MESSAGE),
    ).toMatchObject({
      level: 'error',
      incident: 'qualifier-pairing-late',
      count: 2,
    });
    expect(jobResults(logs)).toEqual([
      { name: 'match-engine.match-kickoff', result: 'succeeded' },
    ]);
  });
});
