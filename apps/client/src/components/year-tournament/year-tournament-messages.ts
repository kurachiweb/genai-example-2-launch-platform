import type {
  TournamentBoardCopy,
  TournamentBracketCopy,
  TournamentFinalCopy,
} from '../tournament/tournament-copy.ts';

export const YEAR_TOURNAMENT_SECTION_TITLE = 'Product of the Yearトーナメント';

export const YEAR_AWARD_NAME = 'Product of the Year';

export const YEAR_FINAL_BADGE = 'Year Final';

export const YEAR_FINAL_TITLE = YEAR_AWARD_NAME;

export const YEAR_FINAL_SUBTITLE = 'トーナメント決勝';

export const yearFinalAwardedMessage = (productName: string): string =>
  `フルタイム！${productName}が${YEAR_FINAL_TITLE}を受賞🎉`;

export const YEAR_FINAL_NO_AWARD_MESSAGE =
  'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません';

// 対象年の表記(「2027年」)に続けてトーナメントの名前を示す
export const yearBracketPageTitle = (yearLabel: string): string =>
  `${yearLabel}の${YEAR_TOURNAMENT_SECTION_TITLE}`;

export const yearBracketCountsLabel = (
  participantCount: number,
  seedCount: number,
): string => `参加${String(participantCount)}・シード${String(seedCount)}`;

export const YEAR_BRACKET_ERROR_MESSAGE =
  'ブラケットを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const YEAR_BOARD_COPY: TournamentBoardCopy = Object.freeze({
  sectionTitle: YEAR_TOURNAMENT_SECTION_TITLE,
});

export const YEAR_FINAL_COPY: TournamentFinalCopy = Object.freeze({
  badge: YEAR_FINAL_BADGE,
  title: YEAR_FINAL_TITLE,
  subtitle: YEAR_FINAL_SUBTITLE,
  awarded: yearFinalAwardedMessage,
  noAward: YEAR_FINAL_NO_AWARD_MESSAGE,
});

export const YEAR_BRACKET_COPY: TournamentBracketCopy = Object.freeze({
  title: YEAR_TOURNAMENT_SECTION_TITLE,
  awardName: YEAR_AWARD_NAME,
  counts: yearBracketCountsLabel,
  error: YEAR_BRACKET_ERROR_MESSAGE,
});
