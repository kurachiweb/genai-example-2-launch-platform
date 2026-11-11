import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';

import { HELP_BACK_TO_TOP_LABEL } from './help-messages.ts';
import { HelpSearchForm } from './help-search-form.tsx';

// 記事の読み込み中にも同じ位置で検索とヘルプトップへの移動ができるよう、記事詳細とそのスケルトンの両方の上部に置く
export function HelpArticleToolbar() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 sm:flex-1">
        <HelpSearchForm value={undefined} />
      </div>
      <Link
        to="/help"
        search={{ q: undefined }}
        className="inline-flex h-11 w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {HELP_BACK_TO_TOP_LABEL}
      </Link>
    </div>
  );
}
