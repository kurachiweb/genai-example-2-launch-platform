import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';
import {
  deriveLaunchStatus,
  type QualifierOutcome,
} from '../../core/product/launch-status.ts';
import type {
  AdminProductDirectory,
  AdminProductLaunchState,
  AdminProductRecord,
  AdminProductSearchFilter,
  AdminProductVisibility,
} from '../../core/product/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;

const CURSOR_PATTERN = /^(\d{1,15}):([0-9A-Z]{26})$/u;

const LIKE_SPECIAL_CHARACTERS = /[\\%_]/gu;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const latestLaunchCandidates = alias(
  productLaunches,
  'latest_launch_candidates',
);

interface SearchCursor {
  readonly createdAt: number;
  readonly productId: string;
}

interface RecordRow {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly handle: string;
  readonly name: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly logoFileId: string;
  readonly hiddenAt: Date | null;
  readonly ownerStatus: 'active' | 'suspended';
  readonly launchId: string | null;
  readonly launchDate: string | null;
  readonly outcome: QualifierOutcome | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
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
    .encode(`${String(position.createdAt)}:${position.productId}`)
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
  const [, createdAt, productId] = CURSOR_PATTERN.exec(text ?? '') ?? [];
  if (createdAt === undefined || productId === undefined) {
    throw invalidCursorError();
  }
  return { createdAt: Number(createdAt), productId };
}

function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  const createdAt = new Date(position.createdAt);
  return or(
    lt(products.createdAt, createdAt),
    and(eq(products.createdAt, createdAt), lt(products.id, position.productId)),
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

// 返す状態はtoLaunchStateがderiveLaunchStatusから導くため、同じ境界の条件をSQLで書き、両者の一致をテストで確かめる
function launchStateCondition(
  state: AdminProductLaunchState,
  today: BusinessDate,
): SQL | undefined {
  const undecided = and(
    isNotNull(productLaunches.id),
    isNull(productLaunches.cancelledAt),
    isNull(productLaunches.outcome),
  );
  switch (state) {
    case 'canceled':
      return isNotNull(productLaunches.cancelledAt);
    case 'won':
    case 'lost':
      return and(
        isNull(productLaunches.cancelledAt),
        eq(productLaunches.outcome, state),
      );
    case 'scheduled':
      return and(undecided, gt(productLaunches.launchDate, today));
    case 'in_progress':
      return and(undecided, lte(productLaunches.launchDate, today));
  }
}

function visibilityCondition(
  visibility: AdminProductVisibility,
): SQL | undefined {
  switch (visibility) {
    case 'hidden':
      return isNotNull(products.hiddenAt);
    case 'owner_suspended':
      return and(isNull(products.hiddenAt), eq(users.status, 'suspended'));
    case 'visible':
      return and(isNull(products.hiddenAt), ne(users.status, 'suspended'));
  }
}

// 予選の組み合わせの後(deriveLaunchStatusのpaired)もローンチ日の前なので、管理画面では明日以降の未確定にまとめる
function toLaunchState(
  launch: {
    readonly launchDate: BusinessDate;
    readonly outcome: QualifierOutcome | null;
    readonly cancelledAt: Date | null;
  },
  now: Date,
): AdminProductLaunchState {
  if (launch.cancelledAt !== null) {
    return 'canceled';
  }
  if (launch.outcome !== null) {
    return launch.outcome;
  }
  return deriveLaunchStatus(launch, now) === 'in_progress'
    ? 'in_progress'
    : 'scheduled';
}

function toVisibility(row: RecordRow): AdminProductVisibility {
  if (row.hiddenAt !== null) {
    return 'hidden';
  }
  return row.ownerStatus === 'suspended' ? 'owner_suspended' : 'visible';
}

function toLatestLaunch(
  row: RecordRow,
  now: Date,
): AdminProductRecord['latestLaunch'] {
  if (row.launchId === null || row.launchDate === null) {
    return null;
  }
  const launchDate = parseBusinessDate(row.launchDate);
  return {
    launchId: row.launchId,
    launchDate,
    state: toLaunchState(
      { launchDate, outcome: row.outcome, cancelledAt: row.cancelledAt },
      now,
    ),
  };
}

function toRecord(row: RecordRow, now: Date): AdminProductRecord {
  return {
    productId: row.productId,
    ownerUserId: row.ownerUserId,
    handle: row.handle,
    name: row.name,
    category: { id: row.categoryId, name: row.categoryName },
    logoFileId: row.logoFileId,
    hiddenAt: row.hiddenAt,
    visibility: toVisibility(row),
    latestLaunch: toLatestLaunch(row, now),
    createdAt: row.createdAt,
  };
}

@injectable()
export class D1AdminProductDirectory implements AdminProductDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async search(
    filter: AdminProductSearchFilter,
    page: { readonly after?: string; readonly limit: number },
    now: Date,
  ): Promise<{
    readonly products: readonly AdminProductRecord[];
    readonly nextCursor: string | null;
  }> {
    assertPageSize(page.limit);
    const today = toBusinessDateTime(now).date;
    const rows: RecordRow[] = await this.db
      .select({
        productId: products.id,
        ownerUserId: products.userId,
        handle: products.handle,
        name: products.name,
        categoryId: productCategories.id,
        categoryName: productCategories.name,
        logoFileId: products.logoFileId,
        hiddenAt: products.hiddenAt,
        ownerStatus: users.status,
        launchId: productLaunches.id,
        launchDate: productLaunches.launchDate,
        outcome: productLaunches.outcome,
        cancelledAt: productLaunches.cancelledAt,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(users, eq(users.id, products.userId))
      .innerJoin(
        productCategories,
        eq(productCategories.id, products.categoryId),
      )
      .leftJoin(
        productLaunches,
        eq(productLaunches.id, sql`(${this.latestLaunchIdQuery()})`),
      )
      .where(
        and(
          notDeleted(products.deletedAt),
          containing(products.name, filter.name),
          containing(products.handle, filter.handle),
          filter.ownerUserId === undefined
            ? undefined
            : eq(products.userId, filter.ownerUserId),
          filter.categoryId === undefined
            ? undefined
            : eq(products.categoryId, filter.categoryId),
          filter.launchState === undefined
            ? undefined
            : launchStateCondition(filter.launchState, today),
          filter.visibility === undefined
            ? undefined
            : visibilityCondition(filter.visibility),
          afterCursor(page.after),
        ),
      )
      .orderBy(desc(products.createdAt), desc(products.id))
      .limit(page.limit + 1);
    const pageRows = rows.slice(0, page.limit);
    const last = pageRows.at(-1);
    return {
      products: pageRows.map((row) => toRecord(row, now)),
      nextCursor:
        rows.length > page.limit && last !== undefined
          ? encodeCursor({
              createdAt: last.createdAt.getTime(),
              productId: last.productId,
            })
          : null,
    };
  }

  // 物理削除済みのプロダクトは行が無いため数えない
  async countRegisteredAt(at: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(products)
      .where(
        and(
          lt(products.createdAt, at),
          or(isNull(products.deletedAt), gte(products.deletedAt, at)),
        ),
      );
    return row?.count ?? 0;
  }

  // latest_launch_dateは取消を含む全ローンチの最大の日付のため、その日のローンチのうちIDの降順の先頭を最新とする
  private latestLaunchIdQuery() {
    return this.db
      .select({ id: latestLaunchCandidates.id })
      .from(latestLaunchCandidates)
      .where(
        and(
          eq(latestLaunchCandidates.productId, products.id),
          eq(latestLaunchCandidates.launchDate, products.latestLaunchDate),
        ),
      )
      .orderBy(desc(latestLaunchCandidates.id))
      .limit(1);
  }
}
