import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';
import type {
  AdminUserDirectory,
  AdminUserRecord,
  AdminUserSearchFilter,
} from '../../core/identity/ports.ts';

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;

// D1のバインド変数の上限(100)から、識別子以外の条件に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const CURSOR_PATTERN = /^(\d{1,15}):([0-9A-Z]{26})$/u;

const LIKE_SPECIAL_CHARACTERS = /[\\%_]/gu;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

interface SearchCursor {
  readonly createdAt: number;
  readonly userId: string;
}

const RECORD_COLUMNS = {
  id: users.id,
  pseudonymousId: users.pseudonymousId,
  handle: users.handle,
  nickname: users.nickname,
  status: users.status,
  suspendedAt: users.suspendedAt,
  createdAt: users.createdAt,
  emailVerifiedAt: users.emailVerifiedAt,
  disposableEmailStatus: users.disposableEmailStatus,
};

type RecordRow = Pick<typeof users.$inferSelect, keyof typeof RECORD_COLUMNS>;

function toRecord(row: RecordRow): AdminUserRecord {
  return {
    userId: row.id,
    pseudonymousId: row.pseudonymousId,
    handle: row.handle,
    nickname: row.nickname,
    status: row.status,
    suspendedAt: row.suspendedAt,
    registeredAt: row.createdAt,
    emailVerified: row.emailVerifiedAt !== null,
    disposableEmailStatus: row.disposableEmailStatus,
  };
}

function validationError(message: string): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message,
  });
}

function assertPageSize(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_PAGE_SIZE ||
    limit > MAX_PAGE_SIZE
  ) {
    throw validationError(
      `取得する件数は${String(MIN_PAGE_SIZE)}〜${String(MAX_PAGE_SIZE)}の整数で指定してください。`,
    );
  }
}

function encodeCursor(position: SearchCursor): string {
  return textEncoder
    .encode(`${String(position.createdAt)}:${position.userId}`)
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeCursor(cursor: string): SearchCursor {
  const text = decodeCursorText(cursor);
  const [, createdAt, userId] = CURSOR_PATTERN.exec(text ?? '') ?? [];
  if (createdAt === undefined || userId === undefined) {
    throw invalidCursorError();
  }
  return { createdAt: Number(createdAt), userId };
}

function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  const createdAt = new Date(position.createdAt);
  return or(
    lt(users.createdAt, createdAt),
    and(eq(users.createdAt, createdAt), lt(users.id, position.userId)),
  );
}

// SQLiteのLIKEはASCIIの大文字小文字を区別しないため、入力のワイルドカードを逃がすだけで大文字小文字を区別しない部分一致になる
function containing(
  column: SQLiteColumn,
  value: string | undefined,
): SQL | undefined {
  if (value === undefined) {
    return undefined;
  }
  const pattern = `%${value.replaceAll(LIKE_SPECIAL_CHARACTERS, '\\$&')}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

// emailの列はCOLLATE NOCASEのため、等号の比較で大文字小文字を区別しない
function sameEmail(email: string | undefined): SQL | undefined {
  return email === undefined ? undefined : eq(users.email, email.trim());
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1AdminUserDirectory implements AdminUserDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async search(
    filter: AdminUserSearchFilter,
    page: { readonly after?: string; readonly limit: number },
  ): Promise<{
    readonly users: readonly AdminUserRecord[];
    readonly nextCursor: string | null;
  }> {
    assertPageSize(page.limit);
    const rows = await this.db
      .select(RECORD_COLUMNS)
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          containing(users.handle, filter.handle),
          containing(users.nickname, filter.nickname),
          sameEmail(filter.email),
          filter.status === undefined
            ? undefined
            : eq(users.status, filter.status),
          afterCursor(page.after),
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(page.limit + 1);
    const pageRows = rows.slice(0, page.limit);
    const last = pageRows.at(-1);
    return {
      users: pageRows.map(toRecord),
      nextCursor:
        rows.length > page.limit && last !== undefined
          ? encodeCursor({
              createdAt: last.createdAt.getTime(),
              userId: last.id,
            })
          : null,
    };
  }

  async findByIds(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminUserRecord>> {
    const chunks = chunk([...new Set(userIds)], IDS_PER_STATEMENT);
    const results = await Promise.all(
      chunks.map((ids) =>
        this.db
          .select(RECORD_COLUMNS)
          .from(users)
          .where(and(inArray(users.id, ids), isNull(users.deletedAt))),
      ),
    );
    return new Map(
      results.flat().map((row) => [row.id, toRecord(row)] as const),
    );
  }

  async findByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const [row] = await this.db
      .select(RECORD_COLUMNS)
      .from(users)
      .where(and(sameEmail(email), isNull(users.deletedAt)))
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }

  // 物理削除済みの利用者は行が無いため数えない
  async countRegisteredAt(at: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          lt(users.createdAt, at),
          or(isNull(users.deletedAt), gte(users.deletedAt, at)),
        ),
      );
    return row?.count ?? 0;
  }
}
