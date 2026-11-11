import { useId, useState } from 'react';

import {
  HELP_ARTICLE_STATUS_LABELS,
  HELP_ARTICLE_STATUSES,
} from '../../../common-lib/help/help-article-status.ts';
import { AdminFilterBar } from '../../../lib/components/admin/admin-filter-bar.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import {
  DELETED_CREATOR_VALUE,
  type HelpArticleFilter,
  type HelpArticleFilterOption,
  helpArticleFilterScopeOf,
  parseHelpArticleFilter,
} from './help-article-filter.ts';
import {
  HELP_ALL_CATEGORIES_LABEL,
  HELP_ALL_CREATORS_LABEL,
  HELP_ALL_STATUSES_LABEL,
  HELP_CATEGORY_FILTER_LABEL,
  HELP_CREATOR_FILTER_LABEL,
  HELP_DELETED_AUTHOR_LABEL,
  HELP_STATUS_FILTER_LABEL,
} from './help-messages.ts';

export interface HelpArticleFiltersProps {
  // URLの条件。外から変わったら入力欄をその値に戻す
  readonly filter: HelpArticleFilter;
  // undefinedは選択肢の読み込み中
  readonly creatorOptions: readonly HelpArticleFilterOption[] | undefined;
  readonly categoryOptions: readonly HelpArticleFilterOption[] | undefined;
  readonly onApply: (filter: HelpArticleFilter) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly creator: string;
  readonly category: string;
  readonly status: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には管理者・カテゴリのIDとステータスになり得ない値を使う
const ALL_VALUE = '*';

const STATUS_OPTIONS: readonly HelpArticleFilterOption[] =
  HELP_ARTICLE_STATUSES.map((status) => ({
    value: status,
    label: HELP_ARTICLE_STATUS_LABELS[status],
  }));

const draftOf = ({
  creator,
  category,
  status,
}: HelpArticleFilter): FilterDraft => ({
  creator: creator ?? ALL_VALUE,
  category: category ?? ALL_VALUE,
  status: status ?? ALL_VALUE,
});

// 適用した条件はURLへ書くため、URLと同じ規則で値の無い項目を除く
const filterOf = (draft: FilterDraft): HelpArticleFilter => {
  const { creator, category, status } = parseHelpArticleFilter({
    ...(draft.creator !== ALL_VALUE && { creator: draft.creator }),
    ...(draft.category !== ALL_VALUE && { category: draft.category }),
    ...(draft.status !== ALL_VALUE && { status: draft.status }),
  });
  return {
    ...(creator !== undefined && { creator }),
    ...(category !== undefined && { category }),
    ...(status !== undefined && { status }),
  };
};

// 選択肢に無い値(作成者が記事を持たなくなった・カテゴリが削除された)がURLの条件に残っていても選んだ状態を示せるよう、IDのまま加える
const withSelected = (
  options: readonly HelpArticleFilterOption[],
  selected: string | undefined,
  labelOf: (value: string) => string = (value) => value,
): readonly HelpArticleFilterOption[] =>
  selected === undefined || options.some(({ value }) => value === selected)
    ? options
    : [...options, { value: selected, label: labelOf(selected) }];

const creatorLabelOf = (value: string): string =>
  value === DELETED_CREATOR_VALUE ? HELP_DELETED_AUTHOR_LABEL : value;

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly HelpArticleFilterOption[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-44 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function HelpArticleFilters({
  filter,
  creatorOptions,
  categoryOptions,
  onApply,
  onReset,
}: HelpArticleFiltersProps) {
  const id = useId();
  const scope = helpArticleFilterScopeOf(filter);
  const [edited, setEdited] = useState(() => ({
    scope,
    draft: draftOf(filter),
  }));
  // ブラウザの戻る操作などでURLの条件が変わったら入力欄を戻す。部品を作り直すと押した「適用」「解除」のボタンが消えてフォーカスを失うため、描画中に状態を差し替える
  if (edited.scope !== scope) {
    setEdited({ scope, draft: draftOf(filter) });
  }
  const { draft } = edited;
  const update = (changes: Partial<FilterDraft>) => {
    setEdited((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
    }));
  };

  return (
    <AdminFilterBar
      onApply={() => {
        onApply(filterOf(draft));
      }}
      onReset={() => {
        setEdited((current) => ({ ...current, draft: draftOf({}) }));
        onReset();
      }}
    >
      <FilterSelect
        id={`${id}-creator`}
        label={HELP_CREATOR_FILTER_LABEL}
        allLabel={HELP_ALL_CREATORS_LABEL}
        value={draft.creator}
        options={withSelected(
          creatorOptions ?? [],
          filter.creator,
          creatorLabelOf,
        )}
        disabled={creatorOptions === undefined}
        onChange={(creator) => {
          update({ creator });
        }}
      />
      <FilterSelect
        id={`${id}-category`}
        label={HELP_CATEGORY_FILTER_LABEL}
        allLabel={HELP_ALL_CATEGORIES_LABEL}
        value={draft.category}
        options={withSelected(categoryOptions ?? [], filter.category)}
        disabled={categoryOptions === undefined}
        onChange={(category) => {
          update({ category });
        }}
      />
      <FilterSelect
        id={`${id}-status`}
        label={HELP_STATUS_FILTER_LABEL}
        allLabel={HELP_ALL_STATUSES_LABEL}
        value={draft.status}
        options={STATUS_OPTIONS}
        disabled={false}
        onChange={(status) => {
          update({ status });
        }}
      />
    </AdminFilterBar>
  );
}
