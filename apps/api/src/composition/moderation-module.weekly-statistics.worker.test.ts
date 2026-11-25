import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../db/client.ts';
import { moderationWeeklyStatistics } from '../../db/schema/moderation/moderation-weekly-statistics.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../lib/core/scheduling/cron-registry.ts';
import {
  addBusinessDays,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
} from '../application/moderation/ports.ts';
import { MODULES } from './modules.ts';

const db = createDatabase(env.DB);

// 業務日付2026-11-20(金曜日)の業務時刻4:21。今週は11/16(月)〜、表示の範囲の最も古い週は5/18(月)〜
const SCHEDULED_TIME = new Date('2026-11-20T12:21:00.000Z');
const NEXT_DAY = new Date('2026-11-21T12:21:00.000Z');
const FIRST_FINISHED_WEEK = parseBusinessDate('2026-05-18');
const CURRENT_WEEK = '2026-11-16';

function contextAt(scheduledTime: Date): ScheduledJobContext {
  return {
    scheduledTime,
    cron: '21 12 * * *',
    business: toBusinessDateTime(scheduledTime),
  };
}

function createJob(reporter: ModerationIncidentReporter): ScheduledJobHandler {
  const overrides = new ContainerModule(({ rebind }) => {
    rebind<ModerationIncidentReporter>(
      MODERATION_TYPES.ModerationIncidentReporter,
    ).toConstantValue(reporter);
  });
  const container: Container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [...MODULES, { bindings: overrides }],
  );
  return container.get<ScheduledJobHandler>(
    MODERATION_TYPES.WeeklyStatisticsJob,
  );
}

function recordingReporter() {
  const reports: {
    readonly incident: ModerationIncident;
    readonly context: ModerationIncidentContext;
  }[] = [];
  const reporter: ModerationIncidentReporter = {
    report: (incident, context) => {
      reports.push({ incident, context });
    },
  };
  return { reporter, reports };
}

async function readRows() {
  return db
    .select({
      id: moderationWeeklyStatistics.id,
      weekStart: moderationWeeklyStatistics.weekStart,
      finalized: moderationWeeklyStatistics.finalized,
      computedAt: moderationWeeklyStatistics.computedAt,
    })
    .from(moderationWeeklyStatistics)
    .orderBy(asc(moderationWeeklyStatistics.weekStart));
}

beforeEach(async () => {
  await db.delete(moderationWeeklyStatistics);
});

describe('週ごとの統計の集計のジョブ(本物の照会とD1)', () => {
  test('行の無い状態の最初の実行で、表示の範囲の26週を確定し今週を集計した27行を保存する', async () => {
    const { reporter, reports } = recordingReporter();

    await createJob(reporter).run(contextAt(SCHEDULED_TIME));

    const rows = await readRows();
    expect(reports).toEqual([]);
    expect(
      rows.map(({ weekStart, finalized, computedAt }) => ({
        weekStart,
        finalized,
        computedAt,
      })),
    ).toStrictEqual([
      ...Array.from({ length: 26 }, (_, index) => ({
        weekStart: addBusinessDays(FIRST_FINISHED_WEEK, index * 7),
        finalized: true,
        computedAt: SCHEDULED_TIME,
      })),
      { weekStart: CURRENT_WEEK, finalized: false, computedAt: SCHEDULED_TIME },
    ]);
  });

  test('翌日の実行は確定した26週を書き換えず、今週の行だけを上書きして行を増やさない', async () => {
    const { reporter, reports } = recordingReporter();
    await createJob(reporter).run(contextAt(SCHEDULED_TIME));
    const before = await readRows();

    await createJob(reporter).run(contextAt(NEXT_DAY));

    const after = await readRows();
    expect(reports).toEqual([]);
    expect(after.map(({ id }) => id)).toStrictEqual(before.map(({ id }) => id));
    expect(after.slice(0, 26)).toStrictEqual(before.slice(0, 26));
    expect(after.at(-1)).toStrictEqual({
      ...before.at(-1),
      computedAt: NEXT_DAY,
    });
  });
});
