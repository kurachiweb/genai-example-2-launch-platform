import type {
  WeekEntryFollowUp,
  WeekFollowUpTarget,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';

export const PENDING_FOLLOW_UP_READ_LIMIT = 50;

const FAILED_MESSAGE = '返金の依頼と知らせに失敗した参加の枠があります';

function failureOf(errors: readonly unknown[]): unknown {
  const [first] = errors;
  return errors.length === 1
    ? first
    : new AggregateError(errors, FAILED_MESSAGE);
}

// 読み取りにカーソルが無く、一時的な失敗で返金待ち・知らせ待ちに残った枠は次の読み取りにも現れるため、試した枠を除いて新しい枠が無くなるまで読む。
// 1つの読み取りの失敗で残りの枠を止めないよう、全ての読み取りを試してから失敗を投げてイベントの再試行に任せる
export async function followUpPendingEntries(
  store: WeekTournamentStore,
  followUp: WeekEntryFollowUp,
  target: WeekFollowUpTarget,
  now: Date,
): Promise<void> {
  const attempted = new Set<string>();
  const errors: unknown[] = [];
  for (;;) {
    const entryIds = (
      await store.listPendingFollowUpsOf(target, PENDING_FOLLOW_UP_READ_LIMIT)
    )
      .map(({ entryId }) => entryId)
      .filter((entryId) => !attempted.has(entryId));
    if (entryIds.length === 0) {
      break;
    }
    for (const entryId of entryIds) {
      attempted.add(entryId);
    }
    try {
      await followUp.process(entryIds, now);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw failureOf(errors);
  }
}
