import type { MatchKind } from '../../graphql/generated/graphql.ts';

export const BYE_LIST_HEADING = '不戦勝';

export const BYE_BADGE_LABEL = '不戦勝';

export const byeCardLabel = (productName: string): string =>
  `${productName}(不戦勝)`;

export interface ByeDescriptionInput {
  readonly kind: MatchKind;
  // マッチ中の対戦相手の退会等による即時の終了で勝ったか。reasonの割り当てに頼らずトーナメントの区画が組み立てた値でも同じ判定にする
  readonly endedEarly: boolean;
  // 確定時のUpvote数を表示設定で整えた文字列
  readonly upvoteCount: string;
}

export function byeDescriptionOf({
  kind,
  endedEarly,
  upvoteCount,
}: ByeDescriptionInput): string {
  const outcome =
    kind === 'QUALIFIER'
      ? 'ディレクトリに掲載されます。'
      : '次のラウンドへ進みます。';
  if (!endedEarly) {
    return `対戦相手不在のため不戦勝。${outcome}`;
  }
  const settled = `対戦相手が不在になったためマッチ終了。${upvoteCount}票のUpvoteで確定し、`;
  return kind === 'QUALIFIER'
    ? `${settled}不戦勝で${outcome}`
    : `${settled}${outcome}`;
}
