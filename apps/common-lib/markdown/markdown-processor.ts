import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import { unified } from 'unified';

import type { HastRoot } from './hast-types.ts';
import { remarkLiteralSyntax } from './plugins/literal-syntax.ts';

// 接頭辞はサニタイズの段階で脚注のIDにも見出しのIDにも同じ値を付けるため、ここでは付けない
const REMARK_REHYPE_OPTIONS = {
  allowDangerousHtml: false,
  clobberPrefix: '',
  footnoteLabel: '脚注',
  footnoteBackLabel: '本文の参照位置へ戻る',
  footnoteLabelProperties: { className: ['sr-only'] },
} as const satisfies RemarkRehypeOptions;

const markdownToHastProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyGfmStrikethrough)
  .use(remarkLiteralSyntax)
  .use(remarkRehype, REMARK_REHYPE_OPTIONS)
  .freeze();

export const markdownToHast = (markdown: string): HastRoot =>
  markdownToHastProcessor.runSync(markdownToHastProcessor.parse(markdown));
