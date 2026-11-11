import { HelpArticleToolbar } from './help-article-toolbar.tsx';
import { HelpLoadError } from './help-load-error.tsx';
import {
  HELP_ARTICLE_ERROR_HEADING,
  HELP_ARTICLE_ERROR_MESSAGE,
} from './help-messages.ts';

export interface HelpArticleErrorProps {
  readonly onRetry: () => Promise<unknown>;
}

// 記事の取得に失敗しても検索とヘルプトップへの移動ができるよう、記事詳細と同じ位置に検索欄と戻る導線を残す。
// 記事のタイトルの見出しが無いため、ページの見出しを画面に見せずに置き、再びの失敗の後のフォーカスの移り先にする
export function HelpArticleError({ onRetry }: HelpArticleErrorProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <HelpArticleToolbar />
      <h1 tabIndex={-1} className="sr-only">
        {HELP_ARTICLE_ERROR_HEADING}
      </h1>
      <HelpLoadError message={HELP_ARTICLE_ERROR_MESSAGE} onRetry={onRetry} />
    </div>
  );
}
