import { and, eq, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import {
  requirePreviousSource,
  type HandleNamespace,
} from './handle-namespace.ts';

// 旧ハンドルを持たない対象でも一括の書き込みへ並べられるよう、何も変えない文を返す
function noopStatement(db: Database): BatchItem<'sqlite'> {
  return db.run(sql`SELECT 1 WHERE 0`);
}

export function previousHandleUpsert(
  db: Database,
  ns: HandleNamespace,
  input: {
    readonly id: string;
    readonly ownerId: string;
    readonly handle: string;
    readonly now: Date;
  },
): BatchItem<'sqlite'> {
  const previous = requirePreviousSource(ns);
  if (previous === undefined) {
    throw new Error(`${ns.name}は旧ハンドルを持たない対象です`);
  }
  const idColumn = sql.identifier(previous.id.name);
  const createdAt = sql.identifier(previous.createdAt.name);
  const updatedAt = sql.identifier(previous.updatedAt.name);
  const owner = sql.identifier(previous.ownerId.name);
  const handle = sql.identifier(previous.handle.name);
  const deletedAt = sql.identifier(previous.deletedAt.name);
  const nowMs = input.now.getTime();
  return db.run(
    sql`INSERT INTO ${previous.table} (${idColumn}, ${owner}, ${handle}, ${createdAt}, ${updatedAt}) VALUES (${input.id}, ${input.ownerId}, ${input.handle}, ${nowMs}, ${nowMs}) ON CONFLICT (${owner}) DO UPDATE SET ${handle} = excluded.${handle}, ${updatedAt} = excluded.${updatedAt}, ${deletedAt} = NULL`,
  );
}

export function previousHandleRelease(
  db: Database,
  ns: HandleNamespace,
  input: { readonly handle: string; readonly exceptOwnerId: string },
): BatchItem<'sqlite'> {
  const previous = requirePreviousSource(ns);
  if (previous === undefined) {
    return noopStatement(db);
  }
  return db
    .delete(previous.table)
    .where(
      and(
        eq(previous.handle, input.handle),
        ne(previous.ownerId, input.exceptOwnerId),
      ),
    );
}

export function previousHandleSoftDelete(
  db: Database,
  ns: HandleNamespace,
  input: { readonly ownerId: string; readonly now: Date },
): BatchItem<'sqlite'> {
  const previous = requirePreviousSource(ns);
  if (previous === undefined) {
    return noopStatement(db);
  }
  const updatedAt = sql.identifier(previous.updatedAt.name);
  const deletedAt = sql.identifier(previous.deletedAt.name);
  const owner = sql.identifier(previous.ownerId.name);
  const nowMs = input.now.getTime();
  return db.run(
    sql`UPDATE ${previous.table} SET ${deletedAt} = ${nowMs}, ${updatedAt} = ${nowMs} WHERE ${owner} = ${input.ownerId} AND ${deletedAt} IS NULL`,
  );
}

export function previousHandleDelete(
  db: Database,
  ns: HandleNamespace,
  ownerId: string,
): BatchItem<'sqlite'> {
  const previous = requirePreviousSource(ns);
  if (previous === undefined) {
    return noopStatement(db);
  }
  return db.delete(previous.table).where(eq(previous.ownerId, ownerId));
}
