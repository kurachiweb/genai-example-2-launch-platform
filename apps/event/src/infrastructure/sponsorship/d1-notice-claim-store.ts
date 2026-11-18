import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type {
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../lib/core/sponsorship/ports.ts';
import type {
  NoticeClaimStore,
  PendingSponsorshipNotice,
  SponsorshipNoticeClaim,
  SponsorshipNoticeKind,
} from '../../application/sponsorship/ports.ts';

type NoticeState = (typeof sponsorships.$inferSelect)['startNotice'];

// 統計の無いD1で依頼待ちの部分索引を確実に使うため指定する。部分索引の条件は'pending'をリテラルで書かないと使えず、使えない条件に変えると実行時のエラーになる
const PENDING_NOTICE_INDEX = 'sponsorships_pending_notice_idx';

const NOTICE_KINDS: readonly SponsorshipNoticeKind[] = Object.freeze([
  'start',
  'end',
  'termination',
]);

const NOTICE_COLUMNS = {
  start: sponsorships.startNotice,
  end: sponsorships.endNotice,
  termination: sponsorships.terminationNotice,
} as const;

function noticeValues(
  kind: SponsorshipNoticeKind,
  state: NoticeState,
  at: Date,
): Partial<typeof sponsorships.$inferInsert> {
  switch (kind) {
    case 'start':
      return { startNotice: state, updatedAt: at };
    case 'end':
      return { endNotice: state, updatedAt: at };
    case 'termination':
      return { terminationNotice: state, updatedAt: at };
  }
}

@injectable()
export class D1NoticeClaimStore implements NoticeClaimStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
  ) {}

  // 1行に複数の通知が依頼待ちになり得るため、行を上限まで読んでから通知に分けて上限で切る
  async listPending(
    limit: number,
  ): Promise<readonly PendingSponsorshipNotice[]> {
    const pendingIds = sql`(select ${sponsorships.id} from ${sponsorships} indexed by ${sql.identifier(PENDING_NOTICE_INDEX)} where (${sponsorships.startNotice} = 'pending' or ${sponsorships.endNotice} = 'pending' or ${sponsorships.terminationNotice} = 'pending') order by ${sponsorships.updatedAt}, ${sponsorships.id} limit ${limit})`;
    const rows = await this.db
      .select({
        id: sponsorships.id,
        start: sponsorships.startNotice,
        end: sponsorships.endNotice,
        termination: sponsorships.terminationNotice,
      })
      .from(sponsorships)
      .where(inArray(sponsorships.id, pendingIds))
      .orderBy(asc(sponsorships.updatedAt), asc(sponsorships.id));
    return rows
      .flatMap((row) =>
        NOTICE_KINDS.filter((kind) => row[kind] === 'pending').map((kind) => ({
          sponsorshipId: row.id,
          kind,
        })),
      )
      .slice(0, limit);
  }

  async claim(
    notice: PendingSponsorshipNotice,
    at: Date,
  ): Promise<SponsorshipNoticeClaim | undefined> {
    const [row] = await this.transition(notice, 'pending', 'requested', at);
    if (row === undefined) {
      return undefined;
    }
    if (row.deletedAt !== null) {
      return { kind: 'deleted' };
    }
    const record = await this.readClaimed(notice, at);
    // 取った後に退会で論理削除された申込は、論理削除済みとして送らない
    return record === undefined
      ? { kind: 'deleted' }
      : { kind: 'claimed', record };
  }

  // 依頼済みのまま残すと依頼待ちの読み出しにも日次の送り直しにも拾われず通知が失われるため、取った後の読み取りの失敗は依頼待ちに戻してから伝える
  private async readClaimed(
    notice: PendingSponsorshipNotice,
    at: Date,
  ): Promise<SponsorshipRecord | undefined> {
    try {
      return await this.store.findById(notice.sponsorshipId);
    } catch (error) {
      await this.release(notice, at);
      throw error;
    }
  }

  async markSkipped(notice: PendingSponsorshipNotice, at: Date): Promise<void> {
    await this.transition(notice, 'requested', 'skipped', at);
  }

  async release(notice: PendingSponsorshipNotice, at: Date): Promise<void> {
    await this.transition(notice, 'requested', 'pending', at);
  }

  private transition(
    notice: PendingSponsorshipNotice,
    from: NoticeState,
    to: NoticeState,
    at: Date,
  ): Promise<{ readonly deletedAt: Date | null }[]> {
    return this.db
      .update(sponsorships)
      .set(noticeValues(notice.kind, to, at))
      .where(
        and(
          eq(sponsorships.id, notice.sponsorshipId),
          eq(NOTICE_COLUMNS[notice.kind], from),
        ),
      )
      .returning({ deletedAt: sponsorships.deletedAt });
  }
}
