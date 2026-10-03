import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '#/lib/utils';

type Props = {
  children: string;
  // 別オリジンへのリンクに付けるrel属性(ページ構成の「外部Webサイトへのリンク」の表に従う)
  externalRel: string;
  size?: 'sm' | 'base';
  className?: string;
};

function isExternal(href: string | undefined): boolean {
  return href != null && /^https?:\/\//.test(href);
}

// GFM準拠で描画する。Raw HTMLは文字列のまま表示され(FR-MDOWN-005)、見出しレベル1と画像は通常の文字列として描画する(FR-MDOWN-008)
function componentsFor(externalRel: string): Components {
  return {
    h1: ({ children }) => <p># {children}</p>,
    img: ({ alt, src }) => (
      <span>
        ![{alt}]({typeof src === 'string' ? src : ''})
      </span>
    ),
    a: ({ href, children }) =>
      isExternal(href) ? (
        <a href={href} target="_blank" rel={externalRel}>
          {children}
        </a>
      ) : (
        <a href={href}>{children}</a>
      ),
    // 表は単語の途中で折り返さず、収まらない場合は横スクロールさせる
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table className="wrap-normal [&_td]:min-w-28 [&_th]:whitespace-nowrap">
          {children}
        </table>
      </div>
    ),
  };
}

export function Markdown({
  children,
  externalRel,
  size = 'base',
  className,
}: Props) {
  return (
    <div
      className={cn(
        'prose max-w-none wrap-anywhere dark:prose-invert',
        'prose-headings:font-extrabold prose-headings:tracking-tight prose-a:text-primary prose-a:underline-offset-2',
        'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:overflow-x-auto prose-pre:bg-[oklch(0.22_0.02_160)] prose-pre:wrap-normal prose-pre:text-[oklch(0.95_0.01_150)] [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        // 引用に自動で付く引用符はユーザーの入力に無い文字のため付けない
        'prose-blockquote:border-primary/40 prose-blockquote:font-normal prose-blockquote:not-italic prose-th:text-left prose-td:align-top [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none',
        size === 'sm' ? 'prose-sm' : 'prose-sm sm:prose-base',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={componentsFor(externalRel)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
