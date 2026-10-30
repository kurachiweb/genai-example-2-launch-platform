import rehypeSanitize from 'rehype-sanitize';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import { unified } from 'unified';

import type {
  HastRoot,
  MdastNode,
  MdastParagraph,
  MdastRoot,
  MdastText,
} from './hast-types.ts';
import { parseWithGuard } from './parse-guard.ts';
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

// 木を辿る処理がスタックあふれを起こす深さは実行環境ごとに異なる。
// どの環境でも同じ結果にするため、全ての環境で辿れる固定の深さを超える文書は原文の文字列として扱う
const MAX_NESTING_DEPTH = 100;

const unsanitizedProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyGfmStrikethrough)
  .use(remarkLiteralSyntax)
  .use(remarkRehype, REMARK_REHYPE_OPTIONS)
  .use(rehypeHeadingIds)
  .freeze();

type ParsedTree = ReturnType<typeof unsanitizedProcessor.parse>;

const exceedsNestingDepth = (root: MdastRoot): boolean => {
  const pending: [MdastNode, number][] = [[root, 0]];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const [node, depth] = entry;
    if (depth > MAX_NESTING_DEPTH) {
      return true;
    }
    for (const child of node.children ?? []) {
      pending.push([child, depth + 1]);
    }
  }
  return false;
};

const literalDocument = (markdown: string): ParsedTree => {
  const text: MdastText = { type: 'text', value: markdown };
  const paragraph: MdastParagraph = { type: 'paragraph', children: [text] };
  const root: MdastRoot = { type: 'root', children: [paragraph] };
  return root as unknown as ParsedTree;
};

const parseWithinNestingDepth = (markdown: string): ParsedTree => {
  const tree = unsanitizedProcessor.parse(markdown);
  return exceedsNestingDepth(tree) ? literalDocument(markdown) : tree;
};

export const processMarkdown = (
  markdown: string,
  idPrefix: string,
): SanitizedTree => {
  const processor = unsanitizedProcessor()
    .use(rehypeSanitize, sanitizeSchemaFor(idPrefix))
    .use(rehypeAnchorPrefix, idPrefix);
  return processor.runSync(
    parseWithGuard(markdown, parseWithinNestingDepth, literalDocument),
  ) as SanitizedTree;
};
