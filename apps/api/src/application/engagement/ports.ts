import type {
  CommentBodyUpdate,
  CommentInsert,
  CommentSoftDelete,
  RatingUpsert,
} from '../../../lib/core/engagement/ports.ts';

// rejectedは書き込みの時点の条件が成り立たず、一括の書き込みごと取り消されたこと
export type WriteOutcome = 'committed' | 'rejected';

export interface CommentPostWrite {
  readonly comment: CommentInsert;
  // 添えなければ既存の評価を変えない
  readonly rating: RatingUpsert | undefined;
}

export interface CommentUpdateWrite {
  readonly body: CommentBodyUpdate;
  // 添えなければ既存の評価を変えない
  readonly rating: RatingUpsert | undefined;
}

// not-foundは書き込みの時点で対象の行が無く、本文を変えなかったこと
export type CommentUpdateOutcome = WriteOutcome | 'not-found';

export interface CommentWriter {
  // コメントの挿入と評価の上書きを1回の一括の書き込みで確定する
  post(input: CommentPostWrite): Promise<WriteOutcome>;
  // 本文の更新(編集の日時を入れる)と評価の上書きを1回の一括の書き込みで確定する
  update(input: CommentUpdateWrite): Promise<CommentUpdateOutcome>;
  // 自分の削除されていないコメントでなく、変更が0行ならnot-found
  remove(input: CommentSoftDelete): Promise<'deleted' | 'not-found'>;
}

export interface RatingWriter {
  // 同じ利用者とプロダクトの評価があれば値を上書きし、無効化の印を保つ
  upsert(input: RatingUpsert): Promise<WriteOutcome>;
}
