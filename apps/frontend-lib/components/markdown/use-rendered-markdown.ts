import { useMemo, useState } from 'react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import {
  type RenderedMarkdown,
  renderMarkdown,
} from '../../../common-lib/markdown/render-markdown.ts';

const sameRel = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((token, index) => token === right[index]));

const sameOptions = (
  left: MarkdownRenderOptions,
  right: MarkdownRenderOptions,
): boolean =>
  left.siteOrigin === right.siteOrigin &&
  left.idScope === right.idScope &&
  sameRel(left.externalLinkRel, right.externalLinkRel) &&
  sameRel(left.sameOriginLinkRel, right.sameOriginLinkRel);

// 呼び出し側は描画のたびに指定を作り直すため、値が同じ間は前の指定のオブジェクトを使い続け、描画のメモ化の依存を変えない
const useStableOptions = (
  options: MarkdownRenderOptions,
): MarkdownRenderOptions => {
  const [stable, setStable] = useState(options);
  if (stable !== options && !sameOptions(stable, options)) {
    setStable(options);
    return options;
  }
  return stable;
};

export function useRenderedMarkdown(
  markdown: string,
  options: MarkdownRenderOptions,
): RenderedMarkdown {
  const stableOptions = useStableOptions(options);
  return useMemo(
    () => renderMarkdown(markdown, stableOptions),
    [markdown, stableOptions],
  );
}
