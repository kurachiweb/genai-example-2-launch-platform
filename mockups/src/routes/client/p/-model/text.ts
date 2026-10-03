// 検索時の正規化(FR-FTS-002のNFKC正規化と、FTS5の`remove_diacritics 2`相当の発音区別符号の除去)を模す
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

export function searchTermsOf(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/u).filter(Boolean);
}

export type TextSegment = { text: string; match: boolean };

// 正規化後の文字列で検索語を探し、一致箇所を元の文字列の範囲に戻して分割する
export function splitByMatches(text: string, query: string): TextSegment[] {
  const terms = searchTermsOf(query);
  if (terms.length === 0) return [{ text, match: false }];

  let normalized = '';
  // 正規化後の各コード単位が、元の文字列のどの文字(開始・終了位置)に由来するか
  const origins: { start: number; end: number }[] = [];
  let offset = 0;
  for (const char of text) {
    const end = offset + char.length;
    const piece = normalizeForSearch(char);
    origins.push(
      ...Array.from({ length: piece.length }, () => ({ start: offset, end })),
    );
    normalized += piece;
    offset = end;
  }

  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      const to = from + term.length - 1;
      ranges.push([origins[from].start, origins[to].end]);
      from = normalized.indexOf(term, from + term.length);
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];

  const merged = ranges
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((acc, [start, end]) => {
      const last = acc.at(-1);
      if (last && start <= last[1]) {
        return [...acc.slice(0, -1), [last[0], Math.max(last[1], end)]];
      }
      return [...acc, [start, end]];
    }, []);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}

export function containsTerms(text: string, query: string): boolean {
  const normalized = normalizeForSearch(text);
  return searchTermsOf(query).some((term) => normalized.includes(term));
}
