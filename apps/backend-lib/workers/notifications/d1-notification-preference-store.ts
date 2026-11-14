import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { verifiedUsers } from '../../../db/schema/identity/visibility.ts';
import { notificationPreferences } from '../../../db/schema/notifications/notification-preferences.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { NotificationPreferenceStore } from '../../core/notifications/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniquePagesOf(userIds: readonly string[]): string[][] {
  return chunk([...new Set(userIds)], IDS_PER_STATEMENT);
}

@injectable()
export class D1NotificationPreferenceStore implements NotificationPreferenceStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async preferencesOf(
    userId: string,
  ): Promise<ReadonlyMap<NotificationTopic, boolean>> {
    const rows = await this.db
      .select({
        topic: notificationPreferences.topic,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const stored = new Map(rows.map((row) => [row.topic, row.enabled]));
    return new Map(
      NOTIFICATION_TOPICS.map((topic) => [topic, stored.get(topic) ?? false]),
    );
  }

  async setPreference(input: {
    readonly userId: string;
    readonly topic: NotificationTopic;
    readonly enabled: boolean;
    readonly at: Date;
  }): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({
        userId: input.userId,
        topic: input.topic,
        enabled: input.enabled,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.topic],
        set: { enabled: input.enabled, updatedAt: input.at },
      });
  }

  async eligibleRecipients(
    userIds: readonly string[],
    topic: NotificationTopic,
  ): Promise<ReadonlySet<string>> {
    const pages = await Promise.all(
      uniquePagesOf(userIds).map((page) =>
        this.db
          .select({ userId: notificationPreferences.userId })
          .from(notificationPreferences)
          .innerJoin(users, eq(users.id, notificationPreferences.userId))
          .where(
            and(
              inArray(notificationPreferences.userId, page),
              eq(notificationPreferences.topic, topic),
              eq(notificationPreferences.enabled, true),
              verifiedUsers(),
            ),
          ),
      ),
    );
    return new Set(pages.flat().map((row) => row.userId));
  }

  async enabledTopicsOf(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadonlySet<NotificationTopic>>> {
    // 受信する種別の無い送信の対象者もキーに残すため、usersを起点に受信する設定の行を外部結合する
    const pages = await Promise.all(
      uniquePagesOf(userIds).map((page) =>
        this.db
          .select({ userId: users.id, topic: notificationPreferences.topic })
          .from(users)
          .leftJoin(
            notificationPreferences,
            and(
              eq(notificationPreferences.userId, users.id),
              eq(notificationPreferences.enabled, true),
            ),
          )
          .where(and(inArray(users.id, page), verifiedUsers())),
      ),
    );
    const byUser = Map.groupBy(pages.flat(), (row) => row.userId);
    return new Map(
      [...byUser].map(([userId, rows]) => [
        userId,
        new Set(rows.flatMap((row) => (row.topic === null ? [] : [row.topic]))),
      ]),
    );
  }

  async deleteAllOf(userId: string): Promise<void> {
    await this.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }
}
