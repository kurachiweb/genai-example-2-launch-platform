import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1EveningDispatchGate } from '../../lib/workers/notifications/d1-evening-dispatch-gate.ts';
import { SourcedProductTrophyReader } from '../application/tournament/product-trophy-reader.ts';
import type { RegisteredTrophySource } from '../application/tournament/trophy-source.ts';
import { DirectoryWeekBoardReader } from '../application/week-tournament/week-board-reader.ts';
import { DirectoryWeekBracketReader } from '../application/week-tournament/week-bracket-reader.ts';
import { DefaultWeekEntryCheckout } from '../application/week-tournament/week-entry-checkout.ts';
import { DirectoryWeekEntryPanelReader } from '../application/week-tournament/week-entry-panel-reader.ts';
import { WeekLaunchSummarySource } from '../application/week-tournament/week-launch-summary-source.ts';
import { WeekProductLockSource } from '../application/week-tournament/week-product-lock-source.ts';
import { WeekRelaunchConditionSource } from '../application/week-tournament/week-relaunch-condition-source.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import {
  EntryFollowUpJob,
  EveningBracketJob,
} from '../application/week-tournament/week-tournament-jobs.ts';
import { WeekTrophySource } from '../application/week-tournament/week-trophy-source.ts';
import { YearTrophySource } from '../application/year-tournament/year-trophy-source.ts';
import * as mainModule from '../index.ts';
import { SentryWeekTournamentIncidentReporter } from '../infrastructure/week-tournament/sentry-week-tournament-incident-reporter.ts';
import { MODULES } from './modules.ts';
import { WEEK_TOURNAMENT_API_MODULE } from './week-tournament-module.ts';

interface LoggedObject {
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['EveningBracketJob', EveningBracketJob],
  ['EntryFollowUpJob', EntryFollowUpJob],
  ['WeekTournamentIncidentReporter', SentryWeekTournamentIncidentReporter],
  ['WeekBoardReader', DirectoryWeekBoardReader],
  ['WeekBracketReader', DirectoryWeekBracketReader],
  ['WeekEntryPanelReader', DirectoryWeekEntryPanelReader],
  ['WeekEntryCheckout', DefaultWeekEntryCheckout],
  ['WeekRelaunchConditionSource', WeekRelaunchConditionSource],
  ['WeekProductLockSource', WeekProductLockSource],
  ['WeekLaunchSummarySource', WeekLaunchSummarySource],
  ['WeekTrophySource', WeekTrophySource],
  ['ProductTrophyReader', SourcedProductTrophyReader],
] as const;

// 識別子の一覧の解決の他に、登録口から組み立てる一覧として確かめる識別子
const REGISTRY_IDENTIFIERS = ['TrophySources'] as const;

const DATE = parseBusinessDate('2026-11-20');

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

function weekJobResults(logs: readonly LoggedObject[]): JobSummary[] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .flatMap((summary) => (summary['jobs'] ?? []) as readonly JobSummary[])
    .filter(({ name }) => name.startsWith('tournament-week.'))
    .map(({ name, result }) => ({ name, result }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのモジュールの一覧へのWeekトーナメントの束縛の登録', () => {
  test('apiのWeekトーナメントのモジュールを、Weekトーナメントとブラケットの共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(
      MODULES.filter((module) => module === WEEK_TOURNAMENT_API_MODULE),
    ).toHaveLength(1);
    expect(WEEK_TOURNAMENT_API_MODULE.name).toBe('api-week-tournament');
    expect(names.filter((name) => name === 'api-week-tournament')).toHaveLength(
      1,
    );
    expect(MODULES.indexOf(WEEK_TOURNAMENT_API_MODULE)).toBeGreaterThan(
      names.indexOf('week-tournament-platform'),
    );
    expect(MODULES.indexOf(WEEK_TOURNAMENT_API_MODULE)).toBeGreaterThan(
      names.indexOf('tournament-platform'),
    );
  });

  test('解決を確かめる識別子はWEEK_TOURNAMENT_API_TYPESの全てである', () => {
    expect(
      [
        ...IMPLEMENTATIONS.map(([name]) => name),
        ...REGISTRY_IDENTIFIERS,
      ].toSorted(),
    ).toEqual(Object.keys(WEEK_TOURNAMENT_API_TYPES).toSorted());
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのWeekトーナメントの束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを実装のクラスに解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(WEEK_TOURNAMENT_API_TYPES[name]),
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

describe('定期実行の経路からのWeekトーナメントのジョブ', () => {
  test('4:21の起動で、再処理の対象の枠が無ければ返金と知らせの再処理のジョブが成功する', async () => {
    const logs = recordConsole();
    vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
      metadata: { metrics: {} },
    } as QueueSendResponse);
    const time = { hour: 4, minute: 21 } as const;
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

    expect(weekJobResults(logs)).toEqual([
      { name: 'tournament-week.entry-follow-up', result: 'succeeded' },
    ]);
  });
});
