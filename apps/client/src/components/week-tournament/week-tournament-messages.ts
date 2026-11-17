export const WEEK_TOURNAMENT_SECTION_TITLE = 'Product of the Weekトーナメント';

export const WEEK_AWARD_NAME = 'Product of the Week';

export const FINAL_DATE_LABEL = '決勝日';

export const BRACKET_LINK_LABEL = 'ブラケットを見る';

export const WEEK_FINAL_BADGE = 'Week Final';

export const WEEK_FINAL_TITLE = WEEK_AWARD_NAME;

export const WEEK_FINAL_SUBTITLE = 'トーナメント決勝';

export const weekFinalAwardedMessage = (productName: string): string =>
  `フルタイム！${productName}が${WEEK_FINAL_TITLE}を受賞🎉`;

export const WEEK_FINAL_NO_AWARD_MESSAGE =
  'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません';

export const weekBracketPageTitle = (weekLabel: string): string =>
  `${weekLabel} ${WEEK_TOURNAMENT_SECTION_TITLE}`;

export const weekBracketCountsLabel = (
  participantCount: number,
  seedCount: number,
): string => `参加${String(participantCount)}・シード${String(seedCount)}`;

export const WEEK_BRACKET_ERROR_MESSAGE =
  'ブラケットを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
