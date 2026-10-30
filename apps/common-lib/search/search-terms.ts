const WHITESPACE_RUN = /\p{White_Space}+/u;

const DOUBLE_QUOTE = /"/g;

export const normalizeSearchTerms = (input: string): readonly string[] =>
  input
    .normalize('NFKC')
    .split(WHITESPACE_RUN)
    .filter((term) => term !== '');

// FTS5の文字列は二重引用符を2つ重ねてエスケープし、引用符の中の演算子や列の指定を文字列として扱う
const toPrefixPhrase = (term: string): string =>
  `"${term.replace(DOUBLE_QUOTE, '""')}"*`;

export const buildFtsMatchExpression = (
  terms: readonly string[],
): string | undefined =>
  terms.length === 0 ? undefined : terms.map(toPrefixPhrase).join(' ');
