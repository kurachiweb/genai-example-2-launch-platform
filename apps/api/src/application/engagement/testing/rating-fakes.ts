import type { RatingScore } from '../../../../common-lib/engagement/engagement-rules.ts';
import type {
  RatingStore,
  RatingUpsert,
} from '../../../../lib/core/engagement/ports.ts';
import type { RatingWriter, WriteOutcome } from '../ports.ts';

// 評価の行の状態。平均と件数は無効化・論理削除・評価者の停止の無い行だけから求める
export interface FakeRatingRow {
  readonly ratingId: string;
  readonly productId: string;
  readonly userId: string;
  readonly score: RatingScore;
  readonly invalidated: boolean;
  readonly deleted: boolean;
  readonly raterSuspended: boolean;
}

export const fakeRatingRowOf = (
  row: Pick<FakeRatingRow, 'ratingId' | 'productId' | 'userId' | 'score'> &
    Partial<FakeRatingRow>,
): FakeRatingRow => ({
  invalidated: false,
  deleted: false,
  raterSuspended: false,
  ...row,
});

const keyOf = (input: {
  readonly productId: string;
  readonly userId: string;
}): string => `${input.productId}:${input.userId}`;

const isValid = (row: FakeRatingRow): boolean =>
  !row.invalidated && !row.deleted && !row.raterSuspended;

export interface FakeRatingWorld {
  readonly store: RatingStore;
  readonly writer: RatingWriter;
  // 書き込みと読み直しで変化を再現するため、テストが書き換える
  readonly rows: Map<string, FakeRatingRow>;
  readonly upserts: RatingUpsert[];
  readonly removes: { readonly productId: string; readonly userId: string }[];
  readonly scoreReads: {
    readonly productId: string;
    readonly userId: string;
  }[];
}

// 本物の上書きの文と同じく、既存の行があれば値だけを変えてIDと無効化の印を保つ。rejectedを返すと行を変えない
export function createFakeRatingWorld(
  input: {
    readonly rows?: readonly FakeRatingRow[];
    readonly onUpsert?: (input: RatingUpsert) => WriteOutcome;
  } = {},
): FakeRatingWorld {
  const rows = new Map(
    (input.rows ?? []).map((row) => [keyOf(row), row] as const),
  );
  const upserts: RatingUpsert[] = [];
  const removes: FakeRatingWorld['removes'] = [];
  const scoreReads: FakeRatingWorld['scoreReads'] = [];
  const store: RatingStore = {
    remove(key) {
      removes.push(key);
      return Promise.resolve(rows.delete(keyOf(key)));
    },
    findScore(key) {
      scoreReads.push(key);
      const row = rows.get(keyOf(key));
      return Promise.resolve(
        row === undefined || row.deleted
          ? undefined
          : { ratingId: row.ratingId, score: row.score },
      );
    },
    summaries(productIds) {
      return Promise.resolve(
        new Map(
          productIds.map((productId) => {
            const scores = [...rows.values()]
              .filter((row) => row.productId === productId && isValid(row))
              .map((row) => row.score);
            return [
              productId,
              {
                average:
                  scores.length === 0
                    ? null
                    : scores.reduce((sum, score) => sum + score, 0) /
                      scores.length,
                count: scores.length,
              },
            ] as const;
          }),
        ),
      );
    },
  };
  const writer: RatingWriter = {
    upsert(rating) {
      upserts.push(rating);
      const outcome = input.onUpsert?.(rating) ?? 'committed';
      if (outcome === 'committed') {
        const current = rows.get(keyOf(rating));
        rows.set(
          keyOf(rating),
          current === undefined || current.deleted
            ? fakeRatingRowOf(rating)
            : { ...current, score: rating.score },
        );
      }
      return Promise.resolve(outcome);
    },
  };
  return { store, writer, rows, upserts, removes, scoreReads };
}
