import { matchEventHandlerRuns } from '../../../../../db/schema/match/match-event-handler-runs.ts';
import { matchEvents } from '../../../../../db/schema/match/match-events.ts';
import { baseInstantOf, type EntityContext } from '../../entities.ts';
import { deterministicUlid } from '../../random.ts';
import {
  matchAt,
  qualifierPlanOf,
  type PlannedMatch,
} from '../../qualifier-history.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { HOUR_MS, scaledCount } from './scale.ts';

// 完了済みのイベントの削除は1回500件×10回(5,000件)まで、滞ったイベントの送り直しは1回100件までのため、どちらも残りが出る件数にする
const COMPLETED_EVENTS = 5_500;

const STALE_EVENTS = 150;

const COMPLETION_DELAY_MS = 2_000;

const STALE_AGE_MS = 3 * HOUR_MS;

const HANDLER_NAME = 'synthetic-readiness-handler';

function oldMatchAt(
  entities: EntityContext,
  plan: ReturnType<typeof qualifierPlanOf>,
  index: number,
): PlannedMatch {
  const match = matchAt(plan, index);
  // 2.2が完了済みのイベントを持たせるのは確定から29日以内のマッチだけで、それより古いマッチには(match_id, type)の一意索引に当たるイベントが無い
  if (match.hasEvents) {
    throw new RangeError(
      `勝利の番号${String(index)}のマッチは既にイベントを持ちます(予選の勝利の数${String(entities.profile.qualifierWins)}に対して対象の件数が多すぎます)`,
    );
  }
  return match;
}

function* plannedMatches(
  entities: EntityContext,
  from: number,
  count: number,
): Generator<PlannedMatch> {
  const plan = qualifierPlanOf(entities);
  for (let index = from; index < from + count; index += 1) {
    yield oldMatchAt(entities, plan, index);
  }
}

const eventId = (
  seed: number,
  match: PlannedMatch,
  type: string,
  at: Date,
): string =>
  deterministicUlid(at, `${String(seed)}:old-event:${match.matchId}:${type}`);

export function* matchEventStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  const completed = scaledCount(entities.profile, COMPLETED_EVENTS);
  const stale = scaledCount(entities.profile, STALE_EVENTS);
  const base = baseInstantOf(entities.baseDate).getTime();
  const { seed } = entities;
  const completedRows = [...plannedMatches(entities, 0, completed)].map(
    (match): SqlRow => ({
      id: eventId(seed, match, 'decided', match.decidedAt),
      matchId: match.matchId,
      matchKind: 'qualifier',
      type: 'decided',
      occurredAt: match.decidedAt,
      status: 'completed',
      dispatchCount: 1,
      lastDispatchedAt: match.decidedAt,
      completedAt: new Date(match.decidedAt.getTime() + COMPLETION_DELAY_MS),
      createdAt: match.decidedAt,
      updatedAt: match.decidedAt,
    }),
  );
  yield* insertStatements(matchEvents, [
    ...completedRows,
    ...[...plannedMatches(entities, completed, stale)].map((match): SqlRow => ({
      id: eventId(seed, match, 'scheduled', match.createdAt),
      matchId: match.matchId,
      matchKind: 'qualifier',
      type: 'scheduled',
      occurredAt: match.createdAt,
      status: 'pending',
      dispatchCount: 1,
      lastDispatchedAt: new Date(base - STALE_AGE_MS),
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    })),
  ]);
  yield* insertStatements(
    matchEventHandlerRuns,
    completedRows.map((row): SqlRow => ({
      id: deterministicUlid(
        row['occurredAt'] as Date,
        `${String(seed)}:old-event-run:${String(row['id'])}`,
      ),
      eventId: row['id'],
      handlerName: HANDLER_NAME,
      completedAt: row['completedAt'],
      createdAt: row['completedAt'],
      updatedAt: row['completedAt'],
    })),
  );
}
