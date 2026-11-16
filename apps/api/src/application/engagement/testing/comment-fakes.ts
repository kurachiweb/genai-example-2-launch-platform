import type { RatingScore } from '../../../../common-lib/engagement/engagement-rules.ts';
import type {
  CommentRecord,
  CommentSoftDelete,
  CommentStore,
  RatingStore,
  RatingSummary,
} from '../../../../lib/core/engagement/ports.ts';
import type {
  CurrentUser,
  UserAccountView,
} from '../../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type {
  CommentPostWrite,
  CommentUpdateOutcome,
  CommentUpdateWrite,
  CommentWriter,
  WriteOutcome,
} from '../ports.ts';
import { LAUNCH_ID, NOW, PRODUCT_ID } from './target-fakes.ts';

export const PARENT_ID = '01JD0CMNT00000000000000001';
export const ROOT_ID = '01JD0CMNT00000000000000002';
export const NEW_COMMENT_ID = '01JD0CMNT00000000000000099';
export const NEW_RATING_ID = '01JD0RATE00000000000000099';

export const currentUserOf = (
  userId: string,
  overrides: Partial<UserAccountView> = {},
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JD0SESN00000000000000001',
  },
  user: {
    id: userId,
    pseudonymousId: '01JD0PSEU00000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'member@mail.example',
    nickname: 'メンバー',
    handle: 'member',
    ...overrides,
  },
});

export const commentRecordOf = (
  overrides: Partial<CommentRecord> = {},
): CommentRecord => ({
  commentId: PARENT_ID,
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  parentId: null,
  rootId: PARENT_ID,
  depth: 1,
  authorUserId: '01JD0USER00000000000000009',
  bodyMarkdown: '親のコメント',
  createdAt: new Date(NOW.getTime() - 60_000),
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  anonymizedAt: null,
  ...overrides,
});

export function createSequentialIds(ids: readonly string[]): IdGenerator {
  let next = 0;
  return {
    generate() {
      const id = ids[next];
      next += 1;
      if (id === undefined) {
        throw new Error('採番するIDが尽きた');
      }
      return id;
    },
  };
}

export interface FakeCommentWriter {
  readonly writer: CommentWriter;
  readonly posts: CommentPostWrite[];
  readonly updates: CommentUpdateWrite[];
  readonly removes: CommentSoftDelete[];
}

// 書き込みの時点の状態の変化を再現するため、呼ばれたときに状態を変えて結果を返す関数を渡せる
export function createFakeCommentWriter(
  handlers: {
    readonly onPost?: (input: CommentPostWrite) => WriteOutcome;
    readonly onUpdate?: (input: CommentUpdateWrite) => CommentUpdateOutcome;
    readonly onRemove?: (input: CommentSoftDelete) => 'deleted' | 'not-found';
  } = {},
): FakeCommentWriter {
  const posts: CommentPostWrite[] = [];
  const updates: CommentUpdateWrite[] = [];
  const removes: CommentSoftDelete[] = [];
  return {
    posts,
    updates,
    removes,
    writer: {
      post(input) {
        posts.push(input);
        return Promise.resolve(handlers.onPost?.(input) ?? 'committed');
      },
      update(input) {
        updates.push(input);
        return Promise.resolve(handlers.onUpdate?.(input) ?? 'committed');
      },
      remove(input) {
        removes.push(input);
        return Promise.resolve(handlers.onRemove?.(input) ?? 'deleted');
      },
    },
  };
}

export interface FakeCommentStore {
  readonly store: CommentStore;
  // 読み直しで変化を再現するため、テストが書き換える
  readonly records: Map<string, CommentRecord>;
  readonly reads: (readonly string[])[];
}

export function createFakeCommentStore(
  records: readonly CommentRecord[] = [],
): FakeCommentStore {
  const map = new Map(records.map((record) => [record.commentId, record]));
  const reads: (readonly string[])[] = [];
  return {
    records: map,
    reads,
    store: {
      findByIds(commentIds) {
        reads.push(commentIds);
        return Promise.resolve(
          new Map(
            commentIds.flatMap((id) => {
              const record = map.get(id);
              return record === undefined ? [] : [[id, record] as const];
            }),
          ),
        );
      },
    },
  };
}

export interface FakeRatingStore {
  readonly store: RatingStore;
  readonly summaryReads: (readonly string[])[];
  readonly scoreReads: {
    readonly productId: string;
    readonly userId: string;
  }[];
}

export function createFakeRatingStore(input: {
  readonly summaries?: ReadonlyMap<string, RatingSummary>;
  // 利用者のID→評価の値
  readonly scores?: ReadonlyMap<string, RatingScore>;
}): FakeRatingStore {
  const summaryReads: FakeRatingStore['summaryReads'] = [];
  const scoreReads: FakeRatingStore['scoreReads'] = [];
  const unexpected = () => {
    throw new Error('この偽物では使わない: remove');
  };
  return {
    summaryReads,
    scoreReads,
    store: {
      remove: unexpected,
      findScore(key) {
        scoreReads.push(key);
        const score = input.scores?.get(key.userId);
        return Promise.resolve(
          score === undefined ? undefined : { ratingId: NEW_RATING_ID, score },
        );
      },
      summaries(productIds) {
        summaryReads.push(productIds);
        return Promise.resolve(
          new Map(
            productIds.flatMap((id) => {
              const summary = input.summaries?.get(id);
              return summary === undefined ? [] : [[id, summary] as const];
            }),
          ),
        );
      },
    },
  };
}
