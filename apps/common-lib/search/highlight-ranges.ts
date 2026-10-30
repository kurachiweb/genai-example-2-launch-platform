import { normalizeSearchTerms } from './search-terms.ts';

export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

interface FoldedCharacter {
  readonly character: string;
  readonly graphemeEnd: number;
}

interface Word {
  readonly start: number;
  readonly characters: readonly FoldedCharacter[];
  readonly folded: string;
}

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

const WORD_CHARACTER = /[\p{L}\p{N}\p{Co}]/u;

// FTS5のunicode61(remove_diacritics 2)は合成済みのラテン文字の発音区別符号と単独の結合文字(U+0300〜U+036F)だけを除き、濁点・半濁点やギリシャ文字・キリル文字の合成済みの符号、異体字セレクタは区別する
const LATIN_DIACRITICS = /(?<=\p{Script=Latin}\p{M}*)[\u0300-\u036f]/gu;
const COMBINING_DIACRITICS = /[\u0300-\u036f]/gu;

const foldGrapheme = (grapheme: string): string =>
  grapheme
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(LATIN_DIACRITICS, '')
    .normalize('NFC')
    .replace(COMBINING_DIACRITICS, '');

const toWord = (
  start: number,
  characters: readonly FoldedCharacter[],
): Word => ({
  start,
  characters,
  folded: characters.map(({ character }) => character).join(''),
});

// unicode61と同じく、折りたたんだ後の文字・数字・私用文字の連続を語とし、それ以外の文字で区切る。語の位置は、その文字を含む元の書記素の境界で表す
const splitWords = (text: string): readonly Word[] => {
  const words: Word[] = [];
  let start = 0;
  let current: FoldedCharacter[] = [];
  for (const { segment, index } of graphemeSegmenter.segment(text)) {
    const graphemeEnd = index + segment.length;
    for (const character of foldGrapheme(segment)) {
      if (WORD_CHARACTER.test(character)) {
        if (current.length === 0) {
          start = index;
        }
        current.push({ character, graphemeEnd });
      } else if (current.length > 0) {
        words.push(toWord(start, current));
        current = [];
      }
    }
  }
  if (current.length > 0) {
    words.push(toWord(start, current));
  }
  return words;
};

const prefixEnd = (word: Word, prefixLength: number): number => {
  let foldedLength = 0;
  for (const { character, graphemeEnd } of word.characters) {
    foldedLength += character.length;
    if (foldedLength >= prefixLength) {
      return graphemeEnd;
    }
  }
  return word.characters.at(-1)?.graphemeEnd ?? word.start;
};

// FTS5の"語"*と同じく、検索語を区切った語の並びが連続して現れ、最後の語だけが前方一致する位置を求める
const findPhraseRanges = (
  words: readonly Word[],
  phrase: readonly string[],
): readonly HighlightRange[] => {
  const last = phrase.at(-1);
  if (last === undefined) {
    return [];
  }
  const leading = phrase.slice(0, -1);
  return words.flatMap((word, index) => {
    const lastWord = words[index + leading.length];
    const matches =
      lastWord !== undefined &&
      leading.every(
        (token, offset) => words[index + offset]?.folded === token,
      ) &&
      lastWord.folded.startsWith(last);
    return matches
      ? [{ start: word.start, end: prefixEnd(lastWord, last.length) }]
      : [];
  });
};

const mergeRanges = (
  ranges: readonly HighlightRange[],
): readonly HighlightRange[] =>
  [...ranges]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<readonly HighlightRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous === undefined || previous.end < range.start) {
        return [...merged, range];
      }
      return [
        ...merged.slice(0, -1),
        { start: previous.start, end: Math.max(previous.end, range.end) },
      ];
    }, []);

export const findHighlightRanges = (
  text: string,
  terms: readonly string[],
): readonly HighlightRange[] => {
  const words = splitWords(text);
  const phrases = terms
    .flatMap((term) => normalizeSearchTerms(term))
    .map((term) => splitWords(term).map(({ folded }) => folded));
  return mergeRanges(
    phrases.flatMap((phrase) => findPhraseRanges(words, phrase)),
  );
};
