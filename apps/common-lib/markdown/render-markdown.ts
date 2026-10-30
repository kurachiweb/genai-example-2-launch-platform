import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import type { MarkdownHeading } from './extract-headings.ts';
import { extractHeadings } from './extract-headings.ts';
import type { MarkdownRenderOptions } from './markdown-options.ts';
import { idPrefixFor, validateRenderOptions } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { plainTextOf } from './plain-text.ts';
import { applyLinkPolicy } from './plugins/link-policy.ts';
import { wrapTables } from './plugins/table-scroll.ts';

export type {
  MarkdownHeading,
  MarkdownHeadingDepth,
} from './extract-headings.ts';

declare const sanitizedHtmlBrand: unique symbol;

export type SanitizedHtml = string & { readonly [sanitizedHtmlBrand]: true };

export interface RenderedMarkdown {
  readonly html: SanitizedHtml;
  readonly headings: readonly MarkdownHeading[];
  readonly plainText: string;
}

const stringifier = unified().use(rehypeStringify).freeze();

type StringifiableTree = Parameters<typeof stringifier.stringify>[0];

export const renderMarkdown = (
  markdown: string,
  options: MarkdownRenderOptions,
): RenderedMarkdown => {
  validateRenderOptions(options);
  const tree = processMarkdown(markdown, idPrefixFor(options.idScope));
  const displayTree = wrapTables(applyLinkPolicy(tree, options));
  return {
    // サニタイズ済みの木にリンクの方針と表の枠だけを適用したHTMLであり、サニタイズ済みの型を作れる唯一の箇所である
    html: stringifier.stringify(
      displayTree as unknown as StringifiableTree,
    ) as SanitizedHtml,
    headings: extractHeadings(tree),
    plainText: plainTextOf(tree),
  };
};
