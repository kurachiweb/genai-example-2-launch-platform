import type { Logger } from '@logtape/logtape';
import { type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type {
  PaymentRecordKind,
  PaymentRecordStatus,
} from '../../../common-lib/payments/payment-record-values.ts';
import type { PurchaseKind } from '../../../common-lib/payments/purchase-kinds.ts';
import type { Database } from '../../../db/client.ts';
import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  PaymentRevenueReport,
  RevenuePeriod,
} from '../../core/payments/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface D1PaymentRevenueReportDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly db: Database;
}

const MAX_PERIODS = 60;

// 1期間の判定に2つ、組の範囲の絞り込みに4つのバインド変数を使うため、D1の上限(100)に収まる数ずつ問い合わせる
const PERIODS_PER_STATEMENT = 40;

const UNMATCHED_LOSS_LOG_LIMIT = 10;

type RecordAlias = 'counted' | 'lost' | 'withdrawn';

const columnOf =
  (alias: RecordAlias) =>
  (column: SQLiteColumn): SQL =>
    sql`${sql.identifier(alias)}.${sql.identifier(column.name)}`;

type FixedValue =
  | Extract<PurchaseKind, 'payments_smoke'>
  | PaymentRecordKind
  | Extract<PaymentRecordStatus, 'succeeded' | 'disputed' | 'dispute_lost'>;

// 固定の値でバインド変数の上限を使わないよう、型で限った定数だけをSQLに埋め込む
function literal(value: FixedValue): SQL {
  return sql.raw(`'${value}'`);
}

const counted = columnOf('counted');
const lost = columnOf('lost');
const withdrawn = columnOf('withdrawn');

const r = paymentRecords;

function notSmoke(column: (c: SQLiteColumn) => SQL): SQL {
  return sql`${column(r.purpose)} <> ${literal('payments_smoke')}`;
}

function within(at: SQL, range: RevenuePeriod): SQL {
  return sql`${at} >= ${range.from.getTime()} AND ${at} < ${range.to.getTime()}`;
}

// 敗北が確定したチャージバックの行。引き落としの額は同じStripeのIDの係争中の行が持つ
function lostDisputes(range: RevenuePeriod): SQL {
  return sql`${notSmoke(lost)} AND ${lost(r.kind)} = ${literal('dispute')} AND ${lost(r.status)} = ${literal('dispute_lost')} AND ${within(lost(r.occurredAt), range)}`;
}

function withdrawalOf(): SQL {
  return sql`${withdrawn(r.stripeReference)} = ${lost(r.stripeReference)} AND ${withdrawn(r.kind)} = ${literal('dispute')} AND ${withdrawn(r.status)} = ${literal('disputed')}`;
}

// 純収益に数える(時刻・金額)の行。返金と引き落としは負の金額で記録されているため、合計がそのまま純収益になる
function revenueEvents(range: RevenuePeriod): SQL {
  const settled = sql`SELECT ${counted(r.occurredAt)} AS at, ${counted(r.amount)} AS amount FROM ${r} AS counted WHERE ${notSmoke(counted)} AND ${counted(r.status)} = ${literal('succeeded')} AND ${counted(r.kind)} IN (${literal('one_time')}, ${literal('subscription')}, ${literal('refund')}) AND ${within(counted(r.occurredAt), range)}`;
  const losses = sql`SELECT ${lost(r.occurredAt)} AS at, coalesce(${withdrawn(r.amount)}, 0) AS amount FROM ${r} AS lost LEFT JOIN ${r} AS withdrawn ON ${withdrawalOf()} WHERE ${lostDisputes(range)}`;
  return sql`${settled} UNION ALL ${losses}`;
}

function spanOf(periods: readonly RevenuePeriod[]): RevenuePeriod {
  return {
    from: new Date(Math.min(...periods.map(({ from }) => from.getTime()))),
    to: new Date(Math.max(...periods.map(({ to }) => to.getTime()))),
  };
}

function periodColumn(index: number): string {
  return `p${String(index)}`;
}

function revenueQuery(periods: readonly RevenuePeriod[]): SQL {
  const at = sql`${sql.identifier('at')}`;
  const sums = sql.join(
    periods.map(
      (period, index) =>
        sql`coalesce(sum(CASE WHEN ${within(at, period)} THEN ${sql.identifier('amount')} ELSE 0 END), 0) AS ${sql.identifier(periodColumn(index))}`,
    ),
    sql`, `,
  );
  return sql`SELECT ${sums} FROM (${revenueEvents(spanOf(periods))}) AS revenue_events`;
}

function unmatchedLossQuery(span: RevenuePeriod): SQL {
  return sql`SELECT ${lost(r.stripeReference)} AS stripe_reference FROM ${r} AS lost WHERE ${lostDisputes(span)} AND NOT EXISTS (SELECT 1 FROM ${r} AS withdrawn WHERE ${withdrawalOf()}) ORDER BY ${lost(r.occurredAt)} LIMIT ${UNMATCHED_LOSS_LOG_LIMIT}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function invalidPeriods(message: string): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message,
  });
}

function assertPeriods(periods: readonly RevenuePeriod[]): void {
  if (periods.length === 0 || periods.length > MAX_PERIODS) {
    throw invalidPeriods(
      `期間は1〜${String(MAX_PERIODS)}個で指定してください。`,
    );
  }
  for (const { from, to } of periods) {
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() >= to.getTime()
    ) {
      throw invalidPeriods(
        '期間の開始は終わりより前の日時で指定してください。',
      );
    }
  }
}

export class D1PaymentRevenueReport implements PaymentRevenueReport {
  private readonly db: Database;
  private readonly logger: Logger;

  constructor(dependencies: D1PaymentRevenueReportDependencies) {
    this.db = dependencies.db;
    this.logger = getAppLogger([dependencies.appName, 'payments', 'revenue']);
  }

  async netRevenue(
    periods: readonly RevenuePeriod[],
  ): Promise<readonly MinorUnitAmount[]> {
    assertPeriods(periods);
    const groups = chunk(periods, PERIODS_PER_STATEMENT);
    const [unmatched, ...sums] = await this.db.batch([
      this.db.all<{ stripe_reference: string }>(
        unmatchedLossQuery(spanOf(periods)),
      ),
      ...groups.map((group) =>
        this.db.all<Record<string, number>>(revenueQuery(group)),
      ),
    ]);
    if (unmatched.length > 0) {
      this.logger.warn(
        '引き落としの記録が無い敗北のチャージバックを0として数えました',
        {
          stripeReferences: unmatched.map((row) => row.stripe_reference),
        },
      );
    }
    return groups.flatMap((group, groupIndex) => {
      const [row] = sums[groupIndex] ?? [];
      return group.map((_, index) => row?.[periodColumn(index)] ?? 0);
    });
  }
}
