import type { TrophyKind } from '../../graphql/generated/graphql.ts';
import { BRACKET_LINK_LABEL } from '../tournament/tournament-copy.ts';
import { WEEK_AWARD_NAME } from '../week-tournament/week-tournament-messages.ts';

export const TROPHY_SHELF_TITLE = 'トロフィー';

export const TROPHY_AWARD_NAMES: Readonly<Record<TrophyKind, string>> =
  Object.freeze({
    YEAR: 'Product of the Year',
    WEEK: WEEK_AWARD_NAME,
  });

export const TROPHY_AWARDED_SUFFIX = '受賞';

export const TROPHY_BRACKET_LINK_LABEL = BRACKET_LINK_LABEL;

// 棚に同じ文言のリンクが並ぶため、リンクの名前は見える文言の前に週の表記または年を補う
export const trophyBracketLinkLabel = (periodLabel: string): string =>
  `${periodLabel}の${TROPHY_BRACKET_LINK_LABEL}`;
