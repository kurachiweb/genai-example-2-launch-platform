import type { EntityContext } from '../entities.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import type {
  DatasetContext,
  SqlStatement,
  SyntheticDataset,
} from '../sql-writer.ts';
import {
  adminCredentialStatements,
  userCredentialStatements,
} from './daily-batch/credentials.ts';
import { databaseOnlyStatements } from './daily-batch/database-only.ts';
import { matchEventStatements } from './daily-batch/match-events.ts';
import { mediaStatements } from './daily-batch/media-files.ts';
import { moreRetentionStatements } from './daily-batch/more-retention.ts';
import { retentionStatements } from './daily-batch/retention.ts';

export {
  DAILY_BATCH_JOB_COVERAGE,
  type DailyBatchJobCoverage,
} from './daily-batch/coverage.ts';
export {
  DEDICATED_ROWS_PER_JOB,
  MEDIA_FILE_KEY_PREFIX,
  MEDIA_KEY_PREFIX,
  ORPHAN_FILE_COUNT,
  mediaFileKeyLike,
  orphanOwnerIdOf,
} from './daily-batch/media-files.ts';

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

// 4:21のジョブが処理する対象。日次タイムラインの順序の小さいジョブから、対象の行を足す
function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  yield* userCredentialStatements(entities);
  yield* adminCredentialStatements(entities);
  yield* retentionStatements(entities);
  yield* moreRetentionStatements(entities);
  yield* databaseOnlyStatements(entities);
  yield* matchEventStatements(entities);
  yield* mediaStatements(entities);
}

export const dailyBatchTargetsDataset: SyntheticDataset = {
  name: 'daily-batch-targets',
  dependsOn: ['users', 'products', 'matches', 'moderation'],
  generate,
};
