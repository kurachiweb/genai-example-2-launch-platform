import type { RenderedMarkdown } from '../../../common-lib/markdown/render-markdown.ts';
import { cn } from '../../utilities/class-names.ts';

export type MarkdownContentSize = 'sm' | 'base';

export interface MarkdownContentProps {
  readonly rendered: RenderedMarkdown;
  readonly size?: MarkdownContentSize;
  readonly className?: string;
}

const SIZE_CLASS_NAMES: Readonly<Record<MarkdownContentSize, string>> = {
  sm: 'prose-sm',
  base: 'prose-sm sm:prose-base',
};

export function MarkdownContent({
  rendered,
  size = 'base',
  className,
}: MarkdownContentProps) {
  return (
    <div
      data-slot="markdown-content"
      className={cn(
        'prose max-w-none wrap-anywhere dark:prose-invert',
        'prose-headings:font-extrabold prose-headings:tracking-tight prose-a:text-primary prose-a:underline-offset-2',
        'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:overflow-x-auto prose-pre:bg-code-block prose-pre:wrap-normal prose-pre:text-code-block-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        // 引用に自動で付く引用符は利用者の入力に無い文字のため付けない
        'prose-blockquote:border-primary/40 prose-blockquote:font-normal prose-blockquote:not-italic prose-th:text-left prose-td:align-top [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none',
        SIZE_CLASS_NAMES[size],
        className,
      )}
      // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- 描画部品がrehype-sanitizeの許可リスト方式で要素・属性・参照先のスキームを絞ったHTMLを、描画部品だけが作れるサニタイズ済みの型で受け取り、生のHTMLを挿入する唯一の箇所とする
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
