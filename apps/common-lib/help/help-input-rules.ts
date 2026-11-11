import type { HandleRule } from '../handles/handle-rules.ts';
import type { LinkRelToken } from '../markdown/markdown-options.ts';
import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import type { MarkdownTextRule } from '../validation/markdown-text-schema.ts';

export const HELP_TITLE_MAX = 100;

export const HELP_SUBTITLE_MAX = 100;

export const HELP_BODY_MAX = 100_000;

export const HELP_SEARCH_QUERY_MAX = 50;

export const HELP_SEARCH_COUNTER_FROM = 40;

export const HELP_SEARCH_RESULT_LIMIT = 100;

export const HELP_REORDER_MAX = 1_000;

// ユーザー・プロダクトのなりすまし対策の予約語は、運営者だけが作るヘルプ記事には適用しない
export const HELP_ARTICLE_HANDLE_RULE: HandleRule = Object.freeze({
  maxLength: 50,
  reservedWords: Object.freeze([]),
});

export const HELP_BODY_RULE: MarkdownTextRule = Object.freeze({
  label: '本文',
  maxGraphemes: HELP_BODY_MAX,
  required: true,
});

export const HELP_ARTICLE_EXTERNAL_LINK_REL: readonly LinkRelToken[] =
  Object.freeze(['noopener']);

export type HelpTextCheck = 'empty' | 'too-long' | 'forbidden-characters';

const checkRequiredText = (
  value: string,
  max: number,
): HelpTextCheck | undefined => {
  // VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
  if (hasForbiddenCharacters(value)) {
    return 'forbidden-characters';
  }
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > max ? 'too-long' : undefined;
};

export const checkHelpTitle = (value: string): HelpTextCheck | undefined =>
  checkRequiredText(value, HELP_TITLE_MAX);

export const checkHelpSubtitle = (value: string): HelpTextCheck | undefined =>
  checkRequiredText(value, HELP_SUBTITLE_MAX);

export const checkHelpSearchQuery = (value: string): 'too-long' | undefined =>
  countGraphemes(trimWhiteSpace(value)) > HELP_SEARCH_QUERY_MAX
    ? 'too-long'
    : undefined;
