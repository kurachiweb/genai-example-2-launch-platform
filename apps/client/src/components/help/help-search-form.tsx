import { useRouter } from '@tanstack/react-router';

import {
  HELP_SEARCH_COUNTER_FROM,
  HELP_SEARCH_QUERY_MAX,
} from '../../../common-lib/help/help-input-rules.ts';
import { KeywordSearchForm } from '../search/keyword-search-form.tsx';
import {
  HELP_SEARCH_FORM_LABEL,
  HELP_SEARCH_PLACEHOLDER,
} from './help-messages.ts';

export interface HelpSearchFormProps {
  // ヘルプトップのURLから正規化した適用中の検索語。記事詳細ではundefined
  readonly value: string | undefined;
}

// 記事詳細からの検索もヘルプトップの検索結果へ移す。検索欄の位置で結果を待てるよう、スクロールを先頭へ戻さない
export function HelpSearchForm({ value }: HelpSearchFormProps) {
  const router = useRouter();
  const search = (q: string | undefined) => {
    void router.navigate({ to: '/help', search: { q }, resetScroll: false });
  };
  return (
    <KeywordSearchForm
      value={value}
      onSearch={search}
      formLabel={HELP_SEARCH_FORM_LABEL}
      placeholder={HELP_SEARCH_PLACEHOLDER}
      maxGraphemes={HELP_SEARCH_QUERY_MAX}
      counterFrom={HELP_SEARCH_COUNTER_FROM}
    />
  );
}
