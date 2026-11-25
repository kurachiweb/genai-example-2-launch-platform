import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
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

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { FLUSH_NOTIFICATION_SLOT_MESSAGE } from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import {
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1EveningDispatchGate } from '../../lib/workers/notifications/d1-evening-dispatch-gate.ts';
import {
  clearNotificationRows,
  readSlotRow,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { clearYearTournamentTables } from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import type { RegisteredTrophySource } from '../application/tournament/trophy-source.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import { WeekTrophySource } from '../application/week-tournament/week-trophy-source.ts';
import { DirectoryYearBoardReader } from '../application/year-tournament/year-board-reader.ts';
import { DirectoryYearBracketReader } from '../application/year-tournament/year-bracket-reader.ts';
import { DefaultYearEntryCheckout } from '../application/year-tournament/year-entry-checkout.ts';
import { DirectoryYearEntryPanelReader } from '../application/year-tournament/year-entry-panel-reader.ts';
import { DefaultYearFinalDateService } from '../application/year-tournament/year-final-date-service.ts';
import { YearLaunchSummarySource } from '../application/year-tournament/year-launch-summary-source.ts';
import { YearProductLockSource } from '../application/year-tournament/year-product-lock-source.ts';
import { YearRelaunchConditionSource } from '../application/year-tournament/year-relaunch-condition-source.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../application/year-tournament/year-tournament-api-types.ts';
import {
  YearEntryFollowUpJob,
  YearEveningBracketJob,
} from '../application/year-tournament/year-tournament-jobs.ts';
import { YearTrophySource } from '../application/year-tournament/year-trophy-source.ts';
import * as mainModule from '../index.ts';
import { D1YearFinalDateWriter } from '../infrastructure/year-tournament/d1-year-final-date-writer.ts';
import { SentryYearTournamentIncidentReporter } from '../infrastructure/year-tournament/sentry-year-tournament-incident-reporter.ts';
import { MODULES } from './modules.ts';
import { WEEK_TOURNAMENT_API_MODULE } from './week-tournament-module.ts';
import { YEAR_TOURNAMENT_API_MODULE } from './year-tournament-module.ts';

interface LoggedObject {
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

interface FlushRequest {
  readonly slotKey: string;
  readonly delaySeconds: number | undefined;
}

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['EveningBracketJob', YearEveningBracketJob],
  ['EntryFollowUpJob', YearEntryFollowUpJob],
  ['YearTournamentIncidentReporter', SentryYearTournamentIncidentReporter],
  ['YearBoardReader', DirectoryYearBoardReader],
  ['YearBracketReader', DirectoryYearBracketReader],
  ['YearEntryPanelReader', DirectoryYearEntryPanelReader],
  ['YearEntryCheckout', DefaultYearEntryCheckout],
  ['YearFinalDateService', DefaultYearFinalDateService],
  ['YearFinalDateWriter', D1YearFinalDateWriter],
  ['YearRelaunchConditionSource', YearRelaunchConditionSource],
  ['YearProductLockSource', YearProductLockSource],
  ['YearLaunchSummarySource', YearLaunchSummarySource],
  ['YearTrophySource', YearTrophySource],
] as const;

const DATE = parseBusinessDate('2026-11-20');
const EVENING_TIME: BusinessTimeOfDay = { hour: 23, minute: 45 };
const MAINTENANCE_TIME: BusinessTimeOfDay = { hour: 4, minute: 21 };

function createContainer(kind: InvocationScopeInfo['kind']): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
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

function recordFlushRequests(): FlushRequest[] {
  const requests: FlushRequest[] = [];
  vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation((message, options) => {
    const envelope = message as QueueEnvelope;
    if (envelope.type === FLUSH_NOTIFICATION_SLOT_MESSAGE.type) {
      const { slotKey } = envelope.body as { readonly slotKey: string };
      requests.push({ slotKey, delaySeconds: options?.delaySeconds });
    }
    return Promise.resolve({ metadata: { metrics: {} } } as QueueSendResponse);
  });
  return requests;
}

async function runScheduled(time: BusinessTimeOfDay): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: toUtcCronExpression(time),
      scheduledTime: fromBusinessDateTime(DATE, time).getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

function tournamentJobResults(logs: readonly LoggedObject[]): JobSummary[] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .flatMap((summary) => (summary['jobs'] ?? []) as readonly JobSummary[])
    .filter(
      ({ name }) =>
        name.startsWith('tournament-week.') ||
        name.startsWith('tournament-year.'),
    )
    .map(({ name, result }) => ({ name, result }));
}

beforeEach(async () => {
  await clearNotificationRows();
  await clearYearTournamentTables();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのモジュールの一覧へのYearトーナメントの束縛の登録', () => {
  test('apiのYearトーナメントのモジュールを、Yearトーナメントの共通の束縛とapiのWeekトーナメントのモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(
      MODULES.filter((module) => module === YEAR_TOURNAMENT_API_MODULE),
    ).toHaveLength(1);
    expect(YEAR_TOURNAMENT_API_MODULE.name).toBe('api-year-tournament');
    expect(names.filter((name) => name === 'api-year-tournament')).toHaveLength(
      1,
    );
    expect(MODULES.indexOf(YEAR_TOURNAMENT_API_MODULE)).toBeGreaterThan(
      names.indexOf('year-tournament-platform'),
    );
    expect(MODULES.indexOf(YEAR_TOURNAMENT_API_MODULE)).toBeGreaterThan(
      MODULES.indexOf(WEEK_TOURNAMENT_API_MODULE),
    );
  });

  test('解決を確かめる識別子はYEAR_TOURNAMENT_API_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(YEAR_TOURNAMENT_API_TYPES).toSorted(),
    );
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのYearトーナメントの束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを実装のクラスに解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(YEAR_TOURNAMENT_API_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );

    test('トロフィーの供給元の一覧は、登録口のYearとWeekの受賞の供給元をorderの順に名前と実装に解決する', () => {
      expect(
        createContainer(kind).get<readonly RegisteredTrophySource[]>(
          WEEK_TOURNAMENT_API_TYPES.TrophySources,
        ),
      ).toEqual([
        {
          name: 'tournament-year.year-trophies',
          source: expect.any(YearTrophySource) as unknown,
        },
        {
          name: 'tournament-week.week-trophies',
          source: expect.any(WeekTrophySource) as unknown,
        },
      ]);
    });

    test('夜の処理が準備の完了を伝える通知の機能の入口を解決する', () => {
      expect(
        createContainer(kind).get(
          NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate,
        ),
      ).toBeInstanceOf(D1EveningDispatchGate);
    });
  },
);

describe('定期実行の経路からのYearトーナメントのジョブ', () => {
  test('4:21の起動で、再処理の対象の枠が無ければ返金と知らせの再処理のジョブがWeekの再処理の後に成功する', async () => {
    const logs = recordConsole();
    recordFlushRequests();

    await runScheduled(MAINTENANCE_TIME);

    expect(tournamentJobResults(logs)).toEqual([
      { name: 'tournament-week.entry-follow-up', result: 'succeeded' },
      { name: 'tournament-year.entry-follow-up', result: 'succeeded' },
    ]);
  });

  test('23:45の起動で、Weekの夜の処理の後に夜の処理が成功し、前提の2つの準備の完了で夜の枠の送り出しを直ちに依頼する', async () => {
    const logs = recordConsole();
    const requests = recordFlushRequests();
    const slot = eveningSlot(DATE);
    vi.useFakeTimers({
      toFake: ['Date'],
      now: fromBusinessDateTime(DATE, EVENING_TIME),
    });

    await runScheduled(EVENING_TIME);

    expect(tournamentJobResults(logs)).toEqual([
      { name: 'tournament-week.evening-bracket', result: 'succeeded' },
      { name: 'tournament-year.evening-bracket', result: 'succeeded' },
    ]);
    expect(
      requests
        .filter(({ slotKey }) => slotKey === slot.key)
        .map(({ delaySeconds }) => delaySeconds)
        .at(-1),
    ).toBe(0);
    expect(await readSlotRow(slot.key)).toMatchObject({
      requiredParticipants: [
        'tournament-week.evening-bracket',
        'tournament-year.evening-bracket',
      ],
      dispatchRequestedAt: expect.any(Date) as Date,
    });
  });
});
