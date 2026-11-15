import type {
  CommentInsert,
  RatingUpsert,
} from '../../../lib/core/engagement/ports.ts';

// rejectedは書き込みの時点の条件が成り立たず、一括の書き込みごと取り消されたこと
export type WriteOutcome = 'committed' | 'rejected';

export interface CommentPostWrite {
  readonly comment: CommentInsert;
  // 添えなければ既存の評価を変えない
  readonly rating: RatingUpsert | undefined;
}

export interface CommentWriter {
  // コメントの挿入と評価の上書きを1回の一括の書き込みで確定する
  post(input: CommentPostWrite): Promise<WriteOutcome>;
}
