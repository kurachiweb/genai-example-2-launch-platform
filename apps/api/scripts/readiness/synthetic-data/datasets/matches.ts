import { directoryEntries } from '../../../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../../../db/schema/directory/product-search-documents.ts';
import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../../../db/schema/match/match-events.ts';
import { matchUpvotes } from '../../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import { qualifierPairings } from '../../../../db/schema/match/qualifier-pairings.ts';
import { productLaunches } from '../../../../db/schema/product/product-launches.ts';
import { productAt, type EntityContext } from '../entities.ts';
import {
  matchAt,
  pairingDaysOf,
  qualifierPlanOf,
  tomorrowMatchOf,
  type PlannedMatch,
  type PlannedSide,
  type QualifierPlan,
  type TomorrowMatch,
} from '../qualifier-history.ts';
import { deterministicUlid } from '../random.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

const QUALIFIER = 'qualifier';

const RECENT_SAMPLE_COUNT = 4;

const EVENT_COMPLETION_DELAY_MS = 2_000;

// 掲載の記録の後に索引の更新の処理が走り、索引文書を書くまでの遅れ
const INDEX_REFRESH_DELAY_MS = 60_000;

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
  ...(context.logoFileId === undefined
    ? {}
    : { logoFileId: context.logoFileId }),
});

function* pairingStatements(
  plan: QualifierPlan,
  tomorrow: TomorrowMatch,
): Generator<SqlStatement> {
  const days = pairingDaysOf(plan).map(
    ({ matchDate, matchCount, launchCount, createdAt, completedAt }) => ({
      matchDate,
      matchCount,
      launchCount,
      createdAt,
      completedAt,
    }),
  );
  const all = [
    ...days,
    {
      matchDate: tomorrow.matchDate,
      matchCount: 1,
      launchCount: tomorrow.sides.length,
      createdAt: tomorrow.createdAt,
      completedAt: tomorrow.createdAt,
    },
  ];
  yield* insertStatements(
    qualifierPairings,
    all.map((day): SqlRow => ({
      id: deterministicUlid(
        day.createdAt,
        `${String(plan.entities.seed)}:pairing:${day.matchDate}`,
      ),
      matchDate: day.matchDate,
      status: 'completed',
      launchCount: day.launchCount,
      matchCount: day.matchCount,
      completedAt: day.completedAt,
      createdAt: day.createdAt,
      updatedAt: day.completedAt,
    })),
  );
}

interface EventPlan {
  readonly type: 'scheduled' | 'started' | 'decided';
  readonly occurredAt: Date;
}

function eventRow(
  seed: number,
  matchId: string,
  { type, occurredAt }: EventPlan,
): SqlRow {
  return {
    id: deterministicUlid(
      occurredAt,
      `${String(seed)}:event:${matchId}:${type}`,
    ),
    matchId,
    matchKind: QUALIFIER,
    type,
    occurredAt,
    status: 'completed',
    dispatchCount: 1,
    lastDispatchedAt: occurredAt,
    completedAt: new Date(occurredAt.getTime() + EVENT_COMPLETION_DELAY_MS),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function eventPlansOf(match: PlannedMatch): readonly EventPlan[] {
  return [
    { type: 'scheduled', occurredAt: match.createdAt },
    ...(match.bye
      ? []
      : [{ type: 'started', occurredAt: match.startedAt } as const]),
    { type: 'decided', occurredAt: match.decidedAt },
  ];
}

function launchRow(match: PlannedMatch, side: PlannedSide): SqlRow {
  return {
    id: side.launchId,
    productId: side.productId,
    launchDate: match.matchDate,
    outcome: side.launchOutcome,
    decidedAt: match.decidedAt,
    createdAt: side.launchCreatedAt,
    updatedAt: match.decidedAt,
  };
}

function entryRow(match: PlannedMatch, side: PlannedSide): SqlRow {
  return {
    id: side.entryId,
    matchId: match.matchId,
    slot: side.slot,
    matchKind: QUALIFIER,
    matchDate: match.matchDate,
    launchId: side.launchId,
    productId: side.productId,
    ownerUserId: side.ownerUserId,
    upvoteCount: side.upvoteCount,
    lastUpvotedAt: side.lastUpvotedAt,
    lastUpvoteSeq: side.lastUpvoteSeq,
    result: side.result,
    createdAt: match.createdAt,
    updatedAt: match.decidedAt,
  };
}

// 最初の勝利の確定で、ディレクトリの掲載の記録と索引文書を作る。索引文書は更新の処理が書いた後の形で、キーワードの抽出は無効にして4:21の再抽出の対象にしない
function* listingStatements(
  entities: EntityContext,
  match: PlannedMatch,
): Generator<SqlStatement> {
  const { winner, decidedAt } = match;
  const product = productAt(entities, winner.productIndex);
  const refreshedAt = new Date(decidedAt.getTime() + INDEX_REFRESH_DELAY_MS);
  yield* insertStatements(directoryEntries, [
    {
      id: deterministicUlid(
        decidedAt,
        `${String(entities.seed)}:directory:${String(winner.productIndex)}`,
      ),
      productId: winner.productId,
      ownerUserId: winner.ownerUserId,
      firstWonAt: decidedAt,
      createdAt: decidedAt,
      updatedAt: decidedAt,
    },
  ]);
  yield* insertStatements(productSearchDocuments, [
    {
      id: winner.productIndex + 1,
      sourceId: winner.productId,
      sourceVersion: refreshedAt,
      keywords: '',
      keywordStatus: 'disabled',
      statusChangedAt: refreshedAt,
      name: product.name,
      tagline: product.tagline,
    },
  ]);
}

function* matchStatements(
  plan: QualifierPlan,
  match: PlannedMatch,
): Generator<SqlStatement> {
  const sides = [
    match.winner,
    ...(match.loser === undefined ? [] : [match.loser]),
  ];
  for (const side of sides) {
    yield* insertStatements(productLaunches, [launchRow(match, side)]);
  }
  yield* insertStatements(matches, [
    {
      id: match.matchId,
      kind: QUALIFIER,
      matchDate: match.matchDate,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
      startedAt: match.startedAt,
      decidedAt: match.decidedAt,
      decision: match.decision,
      createdAt: match.createdAt,
      updatedAt: match.decidedAt,
    },
  ]);
  yield* insertStatements(
    matchEntries,
    sides.map((side) => entryRow(match, side)),
  );
  yield* insertStatements(
    matchUpvotes,
    match.upvotes.map((upvote): SqlRow => ({
      id: upvote.id,
      matchId: match.matchId,
      entryId: upvote.entryId,
      userId: upvote.userId,
      matchDate: match.matchDate,
      upvotedAt: upvote.upvotedAt,
      seq: upvote.seq,
      createdAt: upvote.upvotedAt,
      updatedAt: upvote.upvotedAt,
    })),
  );
  if (match.hasEvents) {
    yield* insertStatements(
      matchEvents,
      eventPlansOf(match).map((event) =>
        eventRow(plan.entities.seed, match.matchId, event),
      ),
    );
  }
  if (match.index < plan.products) {
    yield* listingStatements(plan.entities, match);
  }
}

// 0:00のジョブが開始してマッチ中にする、組み合わせ済みで未開始の予選。予定のイベントは組み合わせの時に配信済みで、開始・確定のイベントはジョブが作る
function* tomorrowStatements(
  seed: number,
  tomorrow: TomorrowMatch,
): Generator<SqlStatement> {
  yield* insertStatements(matches, [
    {
      id: tomorrow.matchId,
      kind: QUALIFIER,
      matchDate: tomorrow.matchDate,
      startsAt: tomorrow.startsAt,
      endsAt: tomorrow.endsAt,
      createdAt: tomorrow.createdAt,
      updatedAt: tomorrow.createdAt,
    },
  ]);
  yield* insertStatements(
    matchEntries,
    tomorrow.sides.map((side): SqlRow => ({
      id: side.entryId,
      matchId: tomorrow.matchId,
      slot: side.slot,
      matchKind: QUALIFIER,
      matchDate: tomorrow.matchDate,
      launchId: side.launchId,
      productId: side.productId,
      ownerUserId: side.ownerUserId,
      createdAt: tomorrow.createdAt,
      updatedAt: tomorrow.createdAt,
    })),
  );
  yield* insertStatements(matchEvents, [
    eventRow(seed, tomorrow.matchId, {
      type: 'scheduled',
      occurredAt: tomorrow.createdAt,
    }),
  ]);
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  const plan = qualifierPlanOf(entities);
  const tomorrow = tomorrowMatchOf(entities);
  yield* pairingStatements(plan, tomorrow);
  yield* tomorrowStatements(context.seed, tomorrow);
  for (let index = 0; index < plan.wins; index += 1) {
    yield* matchStatements(plan, matchAt(plan, index));
  }
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  const entities = entityContextOf(profile, context);
  const plan = qualifierPlanOf(entities);
  const recent = Array.from(
    { length: Math.min(RECENT_SAMPLE_COUNT, plan.wins) },
    (_, offset) => matchAt(plan, plan.wins - 1 - offset).matchId,
  );
  return { matchIds: [tomorrowMatchOf(entities).matchId, ...recent] };
}

export const matchesDataset: SyntheticDataset = {
  name: 'matches',
  dependsOn: ['users', 'products'],
  generate,
  samples,
};
