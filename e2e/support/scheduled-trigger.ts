import {
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
  toUtcCronExpression,
  type BusinessTimeOfDay,
} from '../../apps/backend-lib/core/time/business-time.ts';
import {
  type LocalWorker,
  resolveLocalWorkerOrigin,
} from './local-worker-origins.ts';

export type ScheduledTriggerWorker = LocalWorker;

export interface ScheduledTriggerInput {
  readonly worker: ScheduledTriggerWorker;
  readonly businessDate: string;
  readonly businessTime: string;
}

// Wranglerの版で経路と引数が変わり得るため、ローカルの定期実行の経路はこの1箇所にだけ書く
const LOCAL_SCHEDULED_PATH = '/cdn-cgi/local/scheduled';

const BUSINESS_TIME_PATTERN = /^(?<hour>\d{2}):(?<minute>\d{2})$/u;

const MILLISECONDS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

// 定期実行の起動と実際の時刻の業務日付がずれ得る、業務日付の境界の直前の幅
const BUSINESS_DAY_BOUNDARY_MARGIN_MINUTES = 20;

function parseBusinessTime(value: string): BusinessTimeOfDay {
  const groups = BUSINESS_TIME_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務時刻はHH:mmの形式で指定してください: ${value}`);
  }
  return { hour: Number(groups.hour), minute: Number(groups.minute) };
}

export function buildScheduledTriggerURL(
  input: ScheduledTriggerInput,
  env: Readonly<Record<string, string | undefined>>,
): URL {
  const businessDate = parseBusinessDate(input.businessDate);
  const timeOfDay = parseBusinessTime(input.businessTime);
  const cron = toUtcCronExpression(timeOfDay);
  const scheduledTime = fromBusinessDateTime(businessDate, timeOfDay);
  const url = new URL(
    LOCAL_SCHEDULED_PATH,
    resolveLocalWorkerOrigin(input.worker, env),
  );
  url.searchParams.set('cron', cron);
  url.searchParams.set('time', String(scheduledTime.getTime()));
  return url;
}

export async function triggerScheduled(
  input: ScheduledTriggerInput,
): Promise<void> {
  const url = buildScheduledTriggerURL(input, process.env);
  const target = `${input.worker}の定期実行(cron: ${url.searchParams.get('cron') ?? ''})`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${target}を起こす要求を送れませんでした: ${url.href}`, {
      cause: error,
    });
  }
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(
      `${target}が失敗しました: 状態コード${String(response.status)}`,
    );
  }
}

export function businessDateOf(at: Date): string {
  return toBusinessDateTime(at).date;
}

export function addBusinessDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(
      `加算する日数は整数で指定してください: ${String(days)}`,
    );
  }
  const startOfDay = fromBusinessDateTime(parseBusinessDate(date), {
    hour: 0,
    minute: 0,
  });
  return businessDateOf(
    new Date(startOfDay.getTime() + days * MILLISECONDS_PER_DAY),
  );
}

export function isNearBusinessDayBoundary(now: Date): boolean {
  const { hour, minute } = toBusinessDateTime(now);
  return (
    hour * MINUTES_PER_HOUR + minute >=
    MINUTES_PER_DAY - BUSINESS_DAY_BOUNDARY_MARGIN_MINUTES
  );
}
