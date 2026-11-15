import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import {
  groupKeyFor,
  type NoticeDraft,
  noticeDedupeKey,
  type PendingNotice,
} from '../../core/notifications/notice-plan.ts';
import type { NotificationSlot } from '../../core/notifications/notification-slots.ts';
import type {
  NoticeGroup,
  NoticeRecordResult,
  NoticeSettlement,
  NotificationNoticeStore,
  NotificationSlotStore,
} from '../../core/notifications/ports.ts';
import { noticeInsertStatements } from './notice-insert-statements.ts';

const notices = notificationNotices;

// D1のバインド変数の上限(100)から、IDの一覧以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const LATE_PHASES: ReadonlySet<string> = new Set(['sending', 'done']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniqueSlotsOf(drafts: readonly NoticeDraft[]): NotificationSlot[] {
  return [
    ...new Map(drafts.map((draft) => [draft.slot.key, draft.slot])).values(),
  ];
}

function settlementKeyOf(entry: NoticeSettlement): string {
  return JSON.stringify([entry.status, entry.reason, entry.emailRequestId]);
}

@injectable()
export class D1NotificationNoticeStore implements NotificationNoticeStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore)
    private readonly slots: NotificationSlotStore,
  ) {}

  // 送り出しの段の始まりと通知の挿入が前後しても取りこぼさないよう、枠の段は挿入の後に読む
  async record(
    drafts: readonly NoticeDraft[],
    at: Date,
  ): Promise<NoticeRecordResult> {
    const targetSlots = uniqueSlotsOf(drafts);
    for (const slot of targetSlots) {
      await this.slots.ensure(slot, at);
    }
    const rows = drafts.map((draft) => ({
      id: this.ids.generate(),
      dedupeKey: noticeDedupeKey(draft),
      slotKey: draft.slot.key,
      groupKey: groupKeyFor(draft),
      topic: draft.topic,
      recipientUserId: draft.recipientUserId,
      matchId: draft.matchId,
      entryId: draft.entryId,
      productId: draft.productId,
      eventId: draft.eventId,
      createdAt: at,
      updatedAt: at,
    }));
    const pages = await this.runAll(noticeInsertStatements(this.db, rows));
    const stored = await Promise.all(
      targetSlots.map((slot) => this.slots.find(slot.key)),
    );
    return {
      created: pages.flat().length,
      lateSlotKeys: stored.flatMap((slot) =>
        slot !== undefined && LATE_PHASES.has(slot.phase) ? [slot.key] : [],
      ),
    };
  }

  async nextPendingGroups(
    slotKey: string,
    limit: number,
  ): Promise<readonly NoticeGroup[]> {
    const keys = await this.db
      .selectDistinct({ groupKey: notices.groupKey })
      .from(notices)
      .where(and(eq(notices.slotKey, slotKey), eq(notices.status, 'pending')))
      .orderBy(asc(notices.groupKey))
      .limit(limit);
    if (keys.length === 0) {
      return [];
    }
    const slot = await this.slots.find(slotKey);
    if (slot === undefined) {
      throw new Error(`未送信の通知の送信枠がありません: ${slotKey}`);
    }
    const pages = await Promise.all(
      chunk(
        keys.map((key) => key.groupKey),
        IDS_PER_STATEMENT,
      ).map((page) =>
        this.db
          .select({
            noticeId: notices.id,
            groupKey: notices.groupKey,
            topic: notices.topic,
            recipientUserId: notices.recipientUserId,
            matchId: notices.matchId,
            entryId: notices.entryId,
            productId: notices.productId,
            eventId: notices.eventId,
          })
          .from(notices)
          .where(
            and(
              eq(notices.slotKey, slotKey),
              eq(notices.status, 'pending'),
              inArray(notices.groupKey, page),
            ),
          )
          .orderBy(asc(notices.groupKey), asc(notices.id)),
      ),
    );
    const noticeSlot: NotificationSlot = {
      key: slot.key,
      kind: slot.kind,
      dueAt: slot.dueAt,
      settleUntil: slot.settleUntil,
    };
    const byGroup = Map.groupBy(pages.flat(), (row) => row.groupKey);
    return [...byGroup].map(([groupKey, rows]) => ({
      groupKey,
      notices: rows.map((row): PendingNotice => ({
        noticeId: row.noticeId,
        topic: row.topic,
        recipientUserId: row.recipientUserId,
        slot: noticeSlot,
        matchId: row.matchId,
        entryId: row.entryId,
        productId: row.productId,
        eventId: row.eventId,
      })),
    }));
  }

  async settle(entries: readonly NoticeSettlement[], at: Date): Promise<void> {
    const bySettlement = Map.groupBy(entries, settlementKeyOf);
    await this.runAll(
      [...bySettlement.values()].flatMap((group) => {
        const [first] = group;
        if (first === undefined) {
          return [];
        }
        return chunk(
          [...new Set(group.map((entry) => entry.noticeId))],
          IDS_PER_STATEMENT,
        ).map((page) =>
          this.db
            .update(notices)
            .set({
              status: first.status,
              skipReason: first.reason,
              emailRequestId: first.emailRequestId,
              settledAt: at,
              updatedAt: at,
            })
            .where(
              and(inArray(notices.id, page), eq(notices.status, 'pending')),
            ),
        );
      }),
    );
  }

  async deleteByRecipient(userId: string, limit: number): Promise<number> {
    const targets = await this.db
      .select({ id: notices.id })
      .from(notices)
      .where(eq(notices.recipientUserId, userId))
      .orderBy(asc(notices.id))
      .limit(limit);
    const results = await this.runAll(
      chunk(
        targets.map((target) => target.id),
        IDS_PER_STATEMENT,
      ).map((page) =>
        this.db
          .delete(notices)
          .where(inArray(notices.id, page))
          .returning({ id: notices.id }),
      ),
    );
    return results.flat().length;
  }

  // 分割した文を1つの一括の書き込みにまとめ、途中で失敗した場合に一部だけが変わった状態を残さない
  private async runAll<T extends BatchItem<'sqlite'>>(
    statements: readonly T[],
  ) {
    const [first, ...rest] = statements;
    if (first === undefined) {
      return [];
    }
    return this.db.batch([first, ...rest]);
  }
}
