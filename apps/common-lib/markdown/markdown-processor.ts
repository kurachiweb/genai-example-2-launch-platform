import rehypeSanitize from 'rehype-sanitize';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import { unified } from 'unified';

import type { HastRoot } from './hast-types.ts';
import { rehypeAnchorPrefix } from './plugins/anchor-prefix.ts';
import { rehypeHeadingIds } from './plugins/heading-ids.ts';
import { remarkLiteralSyntax } from './plugins/literal-syntax.ts';
import { sanitizeSchemaFor } from './sanitize-schema.ts';

declare const sanitizedTreeBrand: unique symbol;

export type SanitizedTree = HastRoot & { readonly [sanitizedTreeBrand]: true };

// 接頭辞はサニタイズの段階で脚注のIDにも見出しのIDにも同じ値を付けるため、ここでは付けない
const REMARK_REHYPE_OPTIONS = {
  allowDangerousHtml: false,
  clobberPrefix: '',
  footnoteLabel: '脚注',
  footnoteBackLabel: '本文の参照位置へ戻る',
  footnoteLabelProperties: { className: ['sr-only'] },
} as const satisfies RemarkRehypeOptions;

const unsanitizedProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyGfmStrikethrough)
  .use(remarkLiteralSyntax)
  .use(remarkRehype, REMARK_REHYPE_OPTIONS)
  .use(rehypeHeadingIds)
  .freeze();

export const processMarkdown = (
  markdown: string,
  idPrefix: string,
): SanitizedTree => {
  const processor = unsanitizedProcessor()
    .use(rehypeSanitize, sanitizeSchemaFor(idPrefix))
    .use(rehypeAnchorPrefix, idPrefix);
  return processor.runSync(processor.parse(markdown)) as SanitizedTree;
};
