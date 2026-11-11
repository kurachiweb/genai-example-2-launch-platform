import {
  DIRECTORY_SEARCH_COUNTER_FROM,
  DIRECTORY_SEARCH_MAX_GRAPHEMES,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { KeywordSearchForm } from '../search/keyword-search-form.tsx';
import {
  SEARCH_FORM_LABEL,
  SEARCH_INPUT_PLACEHOLDER,
} from './search-form-messages.ts';

export interface SearchFormProps {
  // URLから正規化した適用中の検索語。外から変わったら入力欄をその値に戻す
  readonly value: string | undefined;
  // 検索語が無ければundefined
  readonly onSearch: (q: string | undefined) => void;
}

export function SearchForm({ value, onSearch }: SearchFormProps) {
  return (
    <KeywordSearchForm
      value={value}
      onSearch={onSearch}
      formLabel={SEARCH_FORM_LABEL}
      placeholder={SEARCH_INPUT_PLACEHOLDER}
      maxGraphemes={DIRECTORY_SEARCH_MAX_GRAPHEMES}
      counterFrom={DIRECTORY_SEARCH_COUNTER_FROM}
    />
  );
}
