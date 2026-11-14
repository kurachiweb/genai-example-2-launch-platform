import type { ReactNode } from 'react';

import { HELP_TOP_TITLE } from './help-messages.ts';
import { HelpSearchForm } from './help-search-form.tsx';

export interface HelpTopFrameProps {
  // URLから正規化した適用中の検索語
  readonly query: string | undefined;
  // 一覧・検索結果・読み込み中・取得の失敗のいずれか
  readonly children: ReactNode;
}

// 読み込み中と取得の失敗でも検索欄を使えるよう、見出しと検索欄を一覧の状態によらず同じ位置に描く。見出しは再試行の後のフォーカスの移り先にする
export function HelpTopFrame({ query, children }: HelpTopFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-10 sm:pt-8">
      <h1
        tabIndex={-1}
        className="text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {HELP_TOP_TITLE}
      </h1>
      <HelpSearchForm value={query} />
      {children}
    </div>
  );
}
