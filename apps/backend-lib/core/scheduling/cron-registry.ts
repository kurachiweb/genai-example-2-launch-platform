import type { ServiceIdentifier } from 'inversify';

import {
  BUSINESS_UTC_OFFSET_MINUTES,
  type BusinessDateTime,
  type BusinessTimeOfDay,
  toUtcCronExpression,
} from '../time/business-time.ts';

export interface ScheduledJobContext {
  readonly scheduledTime: Date;
  readonly cron: string;
  readonly business: BusinessDateTime;
}

export interface ScheduledJobHandler {
  run(context: ScheduledJobContext): Promise<void>;
}

export interface ScheduledJobDefinition {
  readonly name: string;
  readonly at: BusinessTimeOfDay;
  readonly order: number;
  readonly handler: ServiceIdentifier<ScheduledJobHandler>;
}

export interface CronRegistry {
  cronExpressions(): readonly string[];
  jobsFor(cron: string): readonly ScheduledJobDefinition[];
}

export class CronRegistryError extends Error {
  override readonly name = 'CronRegistryError';
}

interface CronSlot {
  readonly cron: string;
  readonly utcMinuteOfDay: number;
  readonly jobs: ScheduledJobDefinition[];
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const NO_JOBS: readonly ScheduledJobDefinition[] = Object.freeze([]);

function cronExpressionOf(definition: ScheduledJobDefinition): string {
  try {
    return toUtcCronExpression(definition.at);
  } catch (error) {
    throw new CronRegistryError(
      `ジョブ${JSON.stringify(definition.name)}の業務時刻が範囲外です`,
      { cause: error },
    );
  }
}

function utcMinuteOfDayOf({ hour, minute }: BusinessTimeOfDay): number {
  const businessMinuteOfDay = hour * MINUTES_PER_HOUR + minute;
  return (
    (businessMinuteOfDay - BUSINESS_UTC_OFFSET_MINUTES + MINUTES_PER_DAY) %
    MINUTES_PER_DAY
  );
}

function assertOrder(definition: ScheduledJobDefinition): void {
  if (!Number.isInteger(definition.order)) {
    throw new CronRegistryError(
      `ジョブ${JSON.stringify(definition.name)}のorderは整数で指定してください: ${String(definition.order)}`,
    );
  }
}

function addToSlot(slot: CronSlot, definition: ScheduledJobDefinition): void {
  const colliding = slot.jobs.find(({ order }) => order === definition.order);
  if (colliding !== undefined) {
    throw new CronRegistryError(
      `同じ時刻(${slot.cron})のジョブ${JSON.stringify(colliding.name)}と${JSON.stringify(definition.name)}のorderが重複しています: ${String(definition.order)}`,
    );
  }
  slot.jobs.push(definition);
}

function groupByCron(
  definitions: readonly ScheduledJobDefinition[],
): Map<string, CronSlot> {
  const names = new Set<string>();
  const slots = new Map<string, CronSlot>();
  for (const definition of definitions) {
    if (names.has(definition.name)) {
      throw new CronRegistryError(
        `ジョブの名前が重複しています: ${JSON.stringify(definition.name)}`,
      );
    }
    names.add(definition.name);
    const cron = cronExpressionOf(definition);
    assertOrder(definition);
    const slot = slots.get(cron) ?? {
      cron,
      utcMinuteOfDay: utcMinuteOfDayOf(definition.at),
      jobs: [],
    };
    addToSlot(slot, definition);
    slots.set(cron, slot);
  }
  return slots;
}

export function createCronRegistry(
  definitions: readonly ScheduledJobDefinition[],
): CronRegistry {
  const slots = [...groupByCron(definitions).values()];
  const cronExpressions = Object.freeze(
    slots
      .toSorted((left, right) => left.utcMinuteOfDay - right.utcMinuteOfDay)
      .map(({ cron }) => cron),
  );
  const jobsByCron = new Map(
    slots.map(({ cron, jobs }) => [
      cron,
      Object.freeze(jobs.toSorted((left, right) => left.order - right.order)),
    ]),
  );
  return Object.freeze({
    cronExpressions: () => cronExpressions,
    jobsFor: (cron: string) => jobsByCron.get(cron) ?? NO_JOBS,
  });
}
