import { truncateGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import { HELP_SEARCH_QUERY_MAX } from './help-input-rules.ts';

export interface HelpTopQuery {
  readonly q: string | undefined;
}

// URLのクエリは数の形の値を数として読み取るため、文字列に戻す
const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined;
};

export const normalizeHelpSearchText = (raw: unknown): string | undefined => {
  const text = textOf(raw);
  if (text === undefined) {
    return undefined;
  }
  const truncated = trimWhiteSpace(
    truncateGraphemes(trimWhiteSpace(text), HELP_SEARCH_QUERY_MAX),
  );
  return truncated === '' ? undefined : truncated;
};

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう未指定の項目もundefinedとして返す
export const normalizeHelpTopQuery = (
  raw: Readonly<Record<string, unknown>>,
): HelpTopQuery => ({ q: normalizeHelpSearchText(raw.q) });
