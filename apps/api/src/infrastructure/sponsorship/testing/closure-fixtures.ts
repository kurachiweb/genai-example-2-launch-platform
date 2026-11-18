import { asc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { sponsorships } from '../../../../db/schema/sponsorship/sponsorships.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  sponsorshipIdOf,
  sponsorshipRefundIdOf,
  T0,
} from '../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';

export const OWNER = 1;

export const OTHER_OWNER = 2;

// OWNERのプロダクト
export const TARGET_PRODUCT = 1;

// OWNERのもう1つのプロダクト
export const SIBLING_PRODUCT = 2;

export const OTHER_PRODUCT = 3;

// 基準時刻の2026-11-25 10:00
export const AT = new Date('2026-11-25T18:00:00.000Z');

export const LATER = new Date('2026-11-25T19:00:00.000Z');

export const CLOSURE_SPONSORSHIPS = Object.freeze({
  // TARGET_PRODUCTの掲載中(11-20〜11-29)
  active: 1,
  // TARGET_PRODUCTの終了日を過ぎた、表示停止の返金が未精算
  endedUnsettled: 2,
  // TARGET_PRODUCTの掲載予定
  scheduled: 3,
  // TARGET_PRODUCTの未決済
  unpaid: 4,
  // TARGET_PRODUCTの終了日を過ぎた、表示停止の返金を依頼済み
  endedSettled: 5,
  // SIBLING_PRODUCTの掲載中
  sibling: 6,
  // OTHER_OWNERのOTHER_PRODUCTの掲載中
  other: 7,
});

const ACTIVE_PERIOD = Object.freeze({
  startsOn: '2026-11-20',
  endsOn: '2026-11-29',
  days: 10,
});

const SETTLED_STOP_REFUND = Object.freeze({
  stopRefundStatus: 'requested',
  stopRefundDays: 2,
  stopRefundAmount: 2_000,
  stopRefundRequestId: sponsorshipRefundIdOf(99),
} as const);

export async function seedClosureScenario(): Promise<void> {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_OWNER);
  await insertSponsorProduct({ index: TARGET_PRODUCT, owner: OWNER });
  await insertSponsorProduct({ index: SIBLING_PRODUCT, owner: OWNER });
  await insertSponsorProduct({ index: OTHER_PRODUCT, owner: OTHER_OWNER });
  const ids = CLOSURE_SPONSORSHIPS;
  await insertSponsorships([
    {
      index: ids.active,
      owner: OWNER,
      product: TARGET_PRODUCT,
      columns: paidColumnsOf(ids.active, ACTIVE_PERIOD),
    },
    {
      index: ids.endedUnsettled,
      owner: OWNER,
      product: TARGET_PRODUCT,
      columns: paidColumnsOf(ids.endedUnsettled, {
        startsOn: '2026-11-10',
        endsOn: '2026-11-16',
      }),
    },
    {
      index: ids.scheduled,
      owner: OWNER,
      product: TARGET_PRODUCT,
      columns: paidColumnsOf(ids.scheduled),
    },
    {
      index: ids.unpaid,
      owner: OWNER,
      product: TARGET_PRODUCT,
      columns: { startsOn: '2026-12-08', endsOn: '2026-12-14' },
    },
    {
      index: ids.endedSettled,
      owner: OWNER,
      product: TARGET_PRODUCT,
      columns: paidColumnsOf(ids.endedSettled, {
        startsOn: '2026-11-01',
        endsOn: '2026-11-07',
        endNotice: 'requested',
        ...SETTLED_STOP_REFUND,
      }),
    },
    {
      index: ids.sibling,
      owner: OWNER,
      product: SIBLING_PRODUCT,
      columns: paidColumnsOf(ids.sibling, ACTIVE_PERIOD),
    },
    {
      index: ids.other,
      owner: OTHER_OWNER,
      product: OTHER_PRODUCT,
      columns: paidColumnsOf(ids.other, ACTIVE_PERIOD),
    },
  ]);
}

export interface ClosureRowState {
  readonly id: string;
  readonly deletedAt: Date | null;
  readonly productDeletedAt: Date | null;
  readonly stopRefundStatus: string;
  readonly updatedAt: Date;
}

export async function readClosureState(): Promise<ClosureRowState[]> {
  return db
    .select({
      id: sponsorships.id,
      deletedAt: sponsorships.deletedAt,
      productDeletedAt: sponsorships.productDeletedAt,
      stopRefundStatus: sponsorships.stopRefundStatus,
      updatedAt: sponsorships.updatedAt,
    })
    .from(sponsorships)
    .orderBy(asc(sponsorships.id));
}

function rowOf(
  index: number,
  columns: Partial<ClosureRowState> = {},
): ClosureRowState {
  return {
    id: sponsorshipIdOf(index),
    deletedAt: null,
    productDeletedAt: null,
    stopRefundStatus:
      index === CLOSURE_SPONSORSHIPS.endedSettled ? 'requested' : 'none',
    updatedAt: T0,
    ...columns,
  };
}

const ALL_INDEXES = Object.values(CLOSURE_SPONSORSHIPS).toSorted(
  (left, right) => left - right,
);

const OWNER_INDEXES: readonly number[] = [
  CLOSURE_SPONSORSHIPS.active,
  CLOSURE_SPONSORSHIPS.endedUnsettled,
  CLOSURE_SPONSORSHIPS.scheduled,
  CLOSURE_SPONSORSHIPS.unpaid,
  CLOSURE_SPONSORSHIPS.endedSettled,
  CLOSURE_SPONSORSHIPS.sibling,
];

const TARGET_PRODUCT_INDEXES: readonly number[] = [
  CLOSURE_SPONSORSHIPS.active,
  CLOSURE_SPONSORSHIPS.endedUnsettled,
  CLOSURE_SPONSORSHIPS.scheduled,
  CLOSURE_SPONSORSHIPS.unpaid,
  CLOSURE_SPONSORSHIPS.endedSettled,
];

// 依頼済みの表示停止の返金は返金不要に変えない
function waivedStopRefundOf(index: number): string {
  return index === CLOSURE_SPONSORSHIPS.endedSettled
    ? 'requested'
    : 'not_needed';
}

export function untouchedState(): ClosureRowState[] {
  return ALL_INDEXES.map((index) => rowOf(index));
}

export function withdrawnState(at: Date): ClosureRowState[] {
  return ALL_INDEXES.map((index) =>
    OWNER_INDEXES.includes(index)
      ? rowOf(index, {
          deletedAt: at,
          stopRefundStatus: waivedStopRefundOf(index),
          updatedAt: at,
        })
      : rowOf(index),
  );
}

interface CompiledStatement {
  toSQL(): { readonly sql: string; readonly params: readonly unknown[] };
}

function isCompiledStatement(value: unknown): value is CompiledStatement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toSQL' in value &&
    typeof value.toSQL === 'function'
  );
}

export function compiledOf(
  statement: BatchItem<'sqlite'>,
): ReturnType<CompiledStatement['toSQL']> {
  if (!isCompiledStatement(statement)) {
    throw new TypeError('文をSQLに変換できません');
  }
  return statement.toSQL();
}

function changesOf(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    'meta' in result &&
    typeof result.meta === 'object' &&
    result.meta !== null &&
    'changes' in result.meta &&
    typeof result.meta.changes === 'number'
  ) {
    return result.meta.changes;
  }
  throw new TypeError('変更の件数を読めません');
}

// 返された文だけを1回の一括の書き込みで実行し、文ごとの変更の件数を返す
export async function commitStatements(
  statements: readonly BatchItem<'sqlite'>[],
): Promise<number[]> {
  const [first, ...rest] = statements;
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  const results = await db.batch([first, ...rest]);
  return results.map(changesOf);
}

export function productDeletedState(at: Date): ClosureRowState[] {
  return ALL_INDEXES.map((index) =>
    TARGET_PRODUCT_INDEXES.includes(index)
      ? rowOf(index, {
          productDeletedAt: at,
          stopRefundStatus: waivedStopRefundOf(index),
          updatedAt: at,
        })
      : rowOf(index),
  );
}
