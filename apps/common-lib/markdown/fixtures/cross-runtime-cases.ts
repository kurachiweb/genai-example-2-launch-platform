import { findHighlightRanges } from '../../search/highlight-ranges.ts';
import { normalizeIndexText } from '../../search/index-text.ts';
import { normalizeSearchTerms } from '../../search/search-terms.ts';
import { countGraphemes } from '../../text/graphemes.ts';
import { extractSearchText } from '../extract-search-text.ts';
import { renderMarkdown } from '../render-markdown.ts';
import type {
  CrossRuntimeMarkdownResults,
  CrossRuntimeTextResults,
} from './cross-runtime-samples.ts';
import {
  CROSS_RUNTIME_DIGEST_SAMPLES,
  CROSS_RUNTIME_HIGHLIGHT_SAMPLES,
  CROSS_RUNTIME_MARKDOWN_SAMPLES,
  CROSS_RUNTIME_RENDER_OPTIONS,
  CROSS_RUNTIME_TEXT_SAMPLES,
} from './cross-runtime-samples.ts';

export interface CrossRuntimeCase {
  readonly name: string;
  readonly actual: () => unknown;
  readonly expected: unknown;
}

const textEncoder = new TextEncoder();

export const markdownResultsOf = (
  markdown: string,
): CrossRuntimeMarkdownResults => {
  const rendered = renderMarkdown(markdown, CROSS_RUNTIME_RENDER_OPTIONS);
  return {
    html: rendered.html,
    headings: rendered.headings,
    plainText: rendered.plainText,
    searchText: extractSearchText(markdown),
    graphemes: countGraphemes(markdown),
  };
};

export const textResultsOf = (text: string): CrossRuntimeTextResults => ({
  graphemes: countGraphemes(text),
  indexText: normalizeIndexText(text),
  searchTerms: normalizeSearchTerms(text),
});

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// 期待値が大きい文書は、結果のJSONのSHA-256で照合する
export const digestOfMarkdownResults = async (
  markdowns: readonly string[],
): Promise<string> =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        textEncoder.encode(JSON.stringify(markdowns.map(markdownResultsOf))),
      ),
    ),
  );

export const CROSS_RUNTIME_CASES: readonly CrossRuntimeCase[] = [
  ...CROSS_RUNTIME_MARKDOWN_SAMPLES.map(({ name, markdown, expected }) => ({
    name: `マークダウン: ${name}`,
    actual: () => markdownResultsOf(markdown),
    expected,
  })),
  ...CROSS_RUNTIME_DIGEST_SAMPLES.map(({ name, markdowns, sha256 }) => ({
    name: `要約値: ${name}`,
    actual: async () => digestOfMarkdownResults(markdowns),
    expected: sha256,
  })),
  ...CROSS_RUNTIME_TEXT_SAMPLES.map(({ name, text, expected }) => ({
    name: `文字列: ${name}`,
    actual: () => textResultsOf(text),
    expected,
  })),
  ...CROSS_RUNTIME_HIGHLIGHT_SAMPLES.map(({ name, text, terms, expected }) => ({
    name: `強調: ${name}`,
    actual: () => findHighlightRanges(text, terms),
    expected,
  })),
];
