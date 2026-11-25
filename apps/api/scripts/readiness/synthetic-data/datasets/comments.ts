import { launchComments } from '../../../../db/schema/engagement/launch-comments.ts';
import {
  LARGEST_CREATOR_INDEX,
  productAt,
  userAt,
  type EntityContext,
} from '../entities.ts';
import { matchAt, qualifierPlanOf } from '../qualifier-history.ts';
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

export interface PlannedComment {
  readonly id: string;
  readonly productId: string;
  readonly launchId: string;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly depth: 1 | 2 | 3;
  readonly authorUserId: string;
  readonly body: string;
  readonly createdAt: Date;
}

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

// 最大のスレッド以外の返信の数の周期。平均1件で、最大のスレッドより必ず少なくする
const REPLY_PATTERN = Object.freeze([0, 2, 0, 1, 0, 3]);

const MAX_OTHER_REPLIES = 3;

// 第3階層の返信にする位置(10件のうち後ろの3件)。親は直前の第2階層の返信
const DEPTH_THREE_FROM = 7;

const DEPTH_TWO_LAST = 6;

const REPLY_CYCLE = 10;

// 最大のスレッドの返信を、投稿の日(0:00〜23:40)に収める間隔
const LARGEST_THREAD_REPLY_GAP_MS = 2 * MINUTE_MS;

const OTHER_REPLY_GAP_MS = 7 * MINUTE_MS;

const ROOT_SLOT_MS = 10 * MINUTE_MS;

const ROOT_SLOTS = 60;

const FIRST_COMMENT_AFTER_KICKOFF_MS = HOUR_MS;

// 勝利の番号へ散らす刻み(素数で、勝利の数と互いに素でなくても同じ勝利に偏りにくい)
const THREAD_STRIDE = 7_919;

const AUTHOR_THREAD_STRIDE = 31;

const AUTHOR_REPLY_STRIDE = 17;

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

const replyCountOf = (
  thread: number,
  largestReplies: number,
  maxOther: number,
): number =>
  thread === 0
    ? largestReplies
    : Math.min(REPLY_PATTERN[thread % REPLY_PATTERN.length] ?? 0, maxOther);

const numberOf = (sequence: number): string =>
  String(sequence + 1).padStart(6, '0');

// 最大のスレッド(スレッド0)は番号0の勝利(作り手のプロダクトの最も古い勝ち)のローンチに付ける。コメントはキックオフの後の日時で、スレッドの中の日時は親より後に並べる
export function* commentPlansOf(
  entities: EntityContext,
): Generator<PlannedComment> {
  const { profile, seed } = entities;
  const plan = qualifierPlanOf(entities);
  const maxOther = Math.min(
    MAX_OTHER_REPLIES,
    profile.repliesInLargestThread - 1,
  );
  const authorAt = (thread: number, reply: number): string =>
    userAt(
      entities,
      (thread * AUTHOR_THREAD_STRIDE + reply * AUTHOR_REPLY_STRIDE + 5) %
        plan.products,
    ).id;
  let sequence = 0;
  for (let thread = 0; sequence < profile.comments; thread += 1) {
    const match = matchAt(
      plan,
      thread === 0 ? 0 : (thread * THREAD_STRIDE) % plan.wins,
    );
    const rootAt = new Date(
      match.startsAt.getTime() +
        FIRST_COMMENT_AFTER_KICKOFF_MS +
        (thread % ROOT_SLOTS) * ROOT_SLOT_MS,
    );
    const target = {
      productId: match.winner.productId,
      launchId: match.winner.launchId,
    };
    const rootId = deterministicUlid(
      rootAt,
      `${String(seed)}:comment:${String(sequence)}`,
    );
    yield {
      ...target,
      id: rootId,
      parentId: null,
      rootId,
      depth: 1,
      authorUserId: authorAt(thread, 0),
      body: `合成コメント${numberOf(sequence)}: 性能の検証のために自動で作ったトップレベルのコメントです。`,
      createdAt: rootAt,
    };
    sequence += 1;
    const gap = thread === 0 ? LARGEST_THREAD_REPLY_GAP_MS : OTHER_REPLY_GAP_MS;
    const replyIds: string[] = [];
    const replies = replyCountOf(
      thread,
      profile.repliesInLargestThread,
      maxOther,
    );
    for (
      let reply = 0;
      reply < replies && sequence < profile.comments;
      reply += 1
    ) {
      const position = reply % REPLY_CYCLE;
      const deeper = position >= DEPTH_THREE_FROM;
      const createdAt = new Date(rootAt.getTime() + (reply + 1) * gap);
      const id = deterministicUlid(
        createdAt,
        `${String(seed)}:comment:${String(sequence)}`,
      );
      replyIds.push(id);
      yield {
        ...target,
        id,
        parentId: deeper
          ? (replyIds[reply - (position - DEPTH_TWO_LAST)] ?? rootId)
          : rootId,
        rootId,
        depth: deeper ? 3 : 2,
        authorUserId: authorAt(thread, reply + 1),
        body: `合成コメント${numberOf(sequence)}: 性能の検証のために自動で作った返信です。`,
        createdAt,
      };
      sequence += 1;
    }
  }
}

function* commentRows(entities: EntityContext): Generator<SqlRow> {
  for (const comment of commentPlansOf(entities)) {
    yield {
      id: comment.id,
      productId: comment.productId,
      launchId: comment.launchId,
      parentId: comment.parentId,
      rootId: comment.rootId,
      depth: comment.depth,
      authorUserId: comment.authorUserId,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.createdAt,
    };
  }
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  yield* insertStatements(
    launchComments,
    commentRows(entityContextOf(profile, context)),
  );
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  return {
    largestThreadProductHandle: [
      productAt(entityContextOf(profile, context), LARGEST_CREATOR_INDEX)
        .handle,
    ],
  };
}

export const commentsDataset: SyntheticDataset = {
  name: 'comments',
  dependsOn: ['users', 'products', 'matches'],
  generate,
  samples,
};
