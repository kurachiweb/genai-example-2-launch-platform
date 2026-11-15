import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import {
  requirePreviousSource,
  type HandleNamespace,
  type HandleSource,
} from './handle-namespace.ts';

export type HandleResolution =
  | {
      readonly kind: 'current';
      readonly ownerId: string;
      readonly handle: string;
    }
  | { readonly kind: 'previous'; readonly ownerId: string }
  | { readonly kind: 'none' };

export interface HandleOccupiedOptions {
  readonly exceptOwnerId?: string;
  readonly includePrevious?: boolean;
}

// 文字列の比較は列のNOCASE照合に任せ、値をSQL側で変換しないことで一意索引を使う
function matchOtherOwners(
  source: HandleSource,
  handle: string,
  exceptOwnerId: string | undefined,
): SQL | undefined {
  return and(
    eq(source.handle, handle),
    exceptOwnerId === undefined ? undefined : ne(source.ownerId, exceptOwnerId),
  );
}

async function existsRow(
  db: Database,
  source: HandleSource,
  condition: SQL | undefined,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(source.table)
    .where(condition)
    .limit(1);
  return rows.length > 0;
}

export async function resolveHandle(
  db: Database,
  ns: HandleNamespace,
  handle: string,
): Promise<HandleResolution> {
  const { current } = ns;
  const previous = requirePreviousSource(ns);
  const [currentRow] = await db
    .select({ ownerId: current.ownerId, handle: current.handle })
    .from(current.table)
    .where(and(eq(current.handle, handle), current.activeCondition))
    .limit(1);
  if (currentRow !== undefined) {
    return {
      kind: 'current',
      ownerId: String(currentRow.ownerId),
      handle: String(currentRow.handle),
    };
  }
  if (previous === undefined) {
    return { kind: 'none' };
  }
  const [previousRow] = await db
    .select({ ownerId: previous.ownerId })
    .from(previous.table)
    .where(and(eq(previous.handle, handle), isNull(previous.deletedAt)))
    .limit(1);
  return previousRow === undefined
    ? { kind: 'none' }
    : { kind: 'previous', ownerId: String(previousRow.ownerId) };
}

export async function isHandleOccupied(
  db: Database,
  ns: HandleNamespace,
  handle: string,
  options: HandleOccupiedOptions = {},
): Promise<boolean> {
  const { exceptOwnerId, includePrevious = false } = options;
  if (
    await existsRow(
      db,
      ns.current,
      matchOtherOwners(ns.current, handle, exceptOwnerId),
    )
  ) {
    return true;
  }
  if (!includePrevious || ns.previous === undefined) {
    return false;
  }
  return existsRow(
    db,
    ns.previous,
    matchOtherOwners(ns.previous, handle, exceptOwnerId),
  );
}

export function handleOccupiedCondition(
  ns: HandleNamespace,
  handle: string,
  options: Pick<HandleOccupiedOptions, 'exceptOwnerId'> = {},
): SQL {
  const { current } = ns;
  const otherOwners = matchOtherOwners(current, handle, options.exceptOwnerId);
  return sql`EXISTS (SELECT 1 FROM ${current.table} WHERE ${otherOwners})`;
}
