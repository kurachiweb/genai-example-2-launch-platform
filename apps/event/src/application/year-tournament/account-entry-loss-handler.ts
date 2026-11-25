import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearEntryFollowUp,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';

const PENDING_FOLLOW_UP_READ_LIMIT = 50;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const FAILED_MESSAGE = '返金の依頼と知らせに失敗した参加の枠があります';

function failureOf(errors: readonly unknown[]): unknown {
  const [first] = errors;
  return errors.length === 1
    ? first
    : new AggregateError(errors, FAILED_MESSAGE);
}

// 未完了の決済の失効はpaymentsの退会の処理が全種別に対して行うため、ここでは喪失と返金だけを扱う。
// 退会済みの利用者には連絡先が引けず、返金の知らせは送らずに省略される。
// 喪失は凍結前の受付中・資格を得た枠だけを書き換え、返金の依頼は枠ごとの依頼キーで重複を除かれるため、再試行・送り直しで同じイベントを何度処理してもよい。失敗は捕まえずに投げ、イベントの再試行に任せる
@injectable()
export class AccountEntryLossHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly store: YearEntryStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryFollowUp)
    private readonly followUp: YearEntryFollowUp,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const now = this.clock.now();
    const forfeited = await this.store.forfeitByOwner(event.userId, now);
    const attempted = new Set(forfeited);
    const errors: unknown[] = [];
    if (forfeited.length > 0) {
      await this.tryProcess(forfeited, now, errors);
    }
    await this.followUpOwnerEntries(event.userId, attempted, now, errors);
    if (errors.length > 0) {
      throw failureOf(errors);
    }
    return DONE;
  }

  // 枠のストアに投稿者で絞る返金待ちの読み取りが無いため、nowまでに更新した返金待ち・知らせ待ちの枠を更新の古い順に読み、退会した利用者の枠だけを処理する。
  // 読み取りにカーソルが無く、一時的な失敗の枠と他の利用者の枠は次の読み取りにも現れるため、読んだ枠を除いて新しい枠が無くなるまで読む。
  // ここで読み切れなかった枠は日次の再処理が扱う
  private async followUpOwnerEntries(
    userId: string,
    attempted: Set<string>,
    now: Date,
    errors: unknown[],
  ): Promise<void> {
    const updatedUntil = new Date(now.getTime() + 1);
    for (;;) {
      const entries = (
        await this.store.listPendingFollowUps(
          updatedUntil,
          PENDING_FOLLOW_UP_READ_LIMIT,
        )
      ).filter(({ entryId }) => !attempted.has(entryId));
      if (entries.length === 0) {
        return;
      }
      for (const { entryId } of entries) {
        attempted.add(entryId);
      }
      const entryIds = entries
        .filter(({ ownerUserId }) => ownerUserId === userId)
        .map(({ entryId }) => entryId);
      if (entryIds.length > 0) {
        await this.tryProcess(entryIds, now, errors);
      }
    }
  }

  // 1回の処理の失敗で残りの読み取りを止めないよう、失敗を集めて最後に投げる
  private async tryProcess(
    entryIds: readonly string[],
    now: Date,
    errors: unknown[],
  ): Promise<void> {
    try {
      await this.followUp.process(entryIds, now);
    } catch (error) {
      errors.push(error);
    }
  }
}
