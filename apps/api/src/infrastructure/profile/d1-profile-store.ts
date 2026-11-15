import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  handleOccupiedCondition,
  isHandleOccupied,
} from '../../../lib/workers/handles/handle-queries.ts';
import {
  previousHandleRelease,
  previousHandleUpsert,
} from '../../../lib/workers/handles/previous-handle-statements.ts';
import { USER_HANDLE_NAMESPACE } from '../../../lib/workers/profile/user-handle-namespace.ts';
import type {
  ProfileHandleOccupiedOptions,
  ProfileSaveInput,
  ProfileSaveResult,
  ProfileSnapshot,
  ProfileStore,
} from '../../application/profile/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// 保存の取り消しが起こす違反だけを分類の対象にする。取り消しは、先頭のプロフィールの挿入のNOT NULL制約(利用者が使えない・ハンドルの食い違い・使用中)か、ハンドルの一意制約(使用中)で起こる。
// D1は`D1_ERROR: NOT NULL constraint failed: user_profiles.user_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const ABORT_VIOLATION_PATTERN =
  /(?:NOT NULL constraint failed: user_profiles\.user_id|UNIQUE constraint failed: (?:users\.handle|user_previous_handles\.(?:handle|user_id)))(?::|$)/u;

function isAbortViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (ABORT_VIOLATION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1ProfileStore implements ProfileStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findSnapshot(userId: string): Promise<ProfileSnapshot | undefined> {
    const [userRows, websiteRows, previousRows] = await this.db.batch([
      this.db
        .select({
          nickname: users.nickname,
          handle: users.handle,
          status: users.status,
          headline: userProfiles.headline,
          bioMarkdown: userProfiles.bioMarkdown,
          avatarFileId: userProfiles.avatarFileId,
        })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(and(eq(users.id, userId), isNull(users.deletedAt))),
      this.db
        .select({
          name: userProfileWebsites.name,
          url: userProfileWebsites.url,
        })
        .from(userProfileWebsites)
        .where(eq(userProfileWebsites.userId, userId))
        .orderBy(asc(userProfileWebsites.position)),
      this.db
        .select({ handle: userPreviousHandles.handle })
        .from(userPreviousHandles)
        .where(
          and(
            eq(userPreviousHandles.ownerId, userId),
            isNull(userPreviousHandles.deletedAt),
          ),
        ),
    ]);
    const [user] = userRows;
    if (user === undefined) {
      return undefined;
    }
    return {
      userId,
      nickname: user.nickname,
      handle: user.handle,
      previousHandle: previousRows[0]?.handle ?? null,
      headline: user.headline,
      bioMarkdown: user.bioMarkdown,
      avatarFileId: user.avatarFileId,
      websites: websiteRows,
      suspended: user.status === 'suspended',
    };
  }

  isHandleOccupied(
    handle: string,
    options: ProfileHandleOccupiedOptions = {},
  ): Promise<boolean> {
    return isHandleOccupied(this.db, USER_HANDLE_NAMESPACE, handle, {
      ...(options.exceptUserId === undefined
        ? {}
        : { exceptOwnerId: options.exceptUserId }),
      ...(options.includePrevious === undefined
        ? {}
        : { includePrevious: options.includePrevious }),
    });
  }

  async findExistingUserIds(
    userIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const pages = await Promise.all(
      chunk([...new Set(userIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, page)),
      ),
    );
    return new Set(pages.flat().map((row) => row.id));
  }

  async save(input: ProfileSaveInput): Promise<ProfileSaveResult> {
    try {
      await this.db.batch(this.saveStatements(input));
      return 'saved';
    } catch (error) {
      if (!isAbortViolation(error)) {
        throw error;
      }
      return this.classifyAbort(input);
    }
  }

  // 一括の書き込みの中では前の文の結果で後の文を分けられないため、先頭のプロフィールの挿入で利用者の状態を条件にする。
  // 満たさなければ利用者IDがNULLになり、NOT NULL制約の違反で後続の文を含む全体が取り消される。
  // ハンドルの比較は表記の違いも検出するためBINARYで行う
  private saveStatements(input: ProfileSaveInput) {
    const { db } = this;
    const { userId, plan, now } = input;
    const occupied =
      plan.handle.kind === 'changed'
        ? sql` AND NOT ${handleOccupiedCondition(USER_HANDLE_NAMESPACE, plan.handle.next, { exceptOwnerId: userId })}`
        : sql``;
    const guardedUserId = sql<string>`CASE WHEN EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${userId} AND ${visibleUsers()} AND ${users.handle} = ${input.expectedHandle} COLLATE BINARY${occupied}) THEN ${userId} ELSE NULL END`;
    const profileContent = {
      headline: input.headline,
      bioMarkdown: input.bioMarkdown,
      avatarFileId: input.avatarFileId,
      updatedAt: now,
    };
    const handleStatements =
      plan.handle.kind === 'changed'
        ? [
            previousHandleRelease(db, USER_HANDLE_NAMESPACE, {
              handle: plan.handle.next,
              exceptOwnerId: userId,
            }),
            previousHandleUpsert(db, USER_HANDLE_NAMESPACE, {
              id: ulid(),
              ownerId: userId,
              handle: plan.handle.previous,
              now,
            }),
          ]
        : [];
    const websiteRows = input.websites.map((website, position) => ({
      id: ulid(),
      userId,
      position,
      name: website.name,
      url: website.url,
      createdAt: now,
      updatedAt: now,
    }));
    return [
      db
        .insert(userProfiles)
        .values({
          id: ulid(),
          userId: guardedUserId,
          createdAt: now,
          ...profileContent,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: profileContent,
        }),
      db
        .update(users)
        .set({ nickname: input.nickname, handle: input.handle, updatedAt: now })
        .where(eq(users.id, userId)),
      ...handleStatements,
      db
        .delete(userProfileWebsites)
        .where(eq(userProfileWebsites.userId, userId)),
      ...(websiteRows.length === 0
        ? []
        : [db.insert(userProfileWebsites).values(websiteRows)]),
    ] as const;
  }

  // 取り消された一括の書き込みは何も残さないため、読み直した状態で理由を分ける
  private async classifyAbort(
    input: ProfileSaveInput,
  ): Promise<Exclude<ProfileSaveResult, 'saved'>> {
    const [row] = await this.db
      .select({
        handle: users.handle,
        visible: sql<number>`${visibleUsers()}`,
      })
      .from(users)
      .where(eq(users.id, input.userId));
    if (row === undefined || row.visible === 0) {
      return 'account-unavailable';
    }
    return row.handle === input.expectedHandle
      ? 'handle-unavailable'
      : 'conflict';
  }
}
