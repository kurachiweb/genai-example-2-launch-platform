import { type RefObject, useId, useRef, useState } from 'react';

import {
  ADMIN_LAUNCH_STATE_LABELS,
  ADMIN_LAUNCH_STATES,
} from '../../../../common-lib/moderation/moderation-labels.ts';
import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { AdminFilterBar } from '../../../../lib/components/admin/admin-filter-bar.tsx';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { PartialErrorState } from '../../../../lib/components/state/partial-error-state.tsx';
import { Input } from '../../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../../lib/components/ui/select/select-value.tsx';
import type { ModerationCategoryOption } from '../../../graphql/admin-moderation-products.ts';
import {
  MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE,
  PRODUCT_FILTER_LABELS,
  PRODUCT_VISIBILITY_LABELS,
} from '../shared/moderation-messages.ts';
import {
  ADMIN_PRODUCT_VISIBILITY_VALUES,
  MODERATION_SEARCH_TERM_MAX,
  type ProductModerationSearch,
  productModerationFilterScopeOf,
  productModerationSearchAt,
  toProductModerationSearch,
} from '../shared/moderation-search.ts';

export interface ProductFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: ProductModerationSearch;
  // undefinedは選択肢の読み込み中か取得の失敗
  readonly categories: readonly ModerationCategoryOption[] | undefined;
  // カテゴリの選択肢の取得の失敗。失敗の間もカテゴリを指定しない絞り込みは使える
  readonly categoriesError?: {
    readonly message: string;
    readonly onRetry: () => void;
  };
  readonly onApply: (search: ProductModerationSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly name: string;
  readonly handle: string;
  readonly ownerHandle: string;
  readonly category: string;
  readonly launchState: string;
  readonly visibility: string;
}

type SearchTermKey = 'name' | 'handle' | 'ownerHandle';

const SEARCH_TERM_KEYS: readonly SearchTermKey[] = [
  'name',
  'handle',
  'ownerHandle',
];

const NO_TOO_LONG_TERMS: readonly SearchTermKey[] = Object.freeze([]);

// URLの正規化と同じく前後の空白を除いた書記素で数え、上限を超えた欄を画面の並び順で返す
const tooLongTermsOf = (draft: FilterDraft): readonly SearchTermKey[] =>
  SEARCH_TERM_KEYS.filter(
    (key) =>
      countGraphemes(trimWhiteSpace(draft[key])) > MODERATION_SEARCH_TERM_MAX,
  );

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢にはカテゴリのID・状態の値になり得ない値を使う
const ALL_VALUE = '*';

const LAUNCH_STATE_OPTIONS: readonly FilterOption[] = ADMIN_LAUNCH_STATES.map(
  (state) => ({ value: state, label: ADMIN_LAUNCH_STATE_LABELS[state] }),
);

const VISIBILITY_OPTIONS: readonly FilterOption[] =
  ADMIN_PRODUCT_VISIBILITY_VALUES.map((visibility) => ({
    value: visibility,
    label: PRODUCT_VISIBILITY_LABELS[visibility],
  }));

const draftOf = (search: ProductModerationSearch): FilterDraft => ({
  name: search.name ?? '',
  handle: search.handle ?? '',
  ownerHandle: search.ownerHandle ?? '',
  category: search.category ?? ALL_VALUE,
  launchState: search.launchState ?? ALL_VALUE,
  visibility: search.visibility ?? ALL_VALUE,
});

const selectedOf = (value: string): string | undefined =>
  value === ALL_VALUE ? undefined : value;

// 適用した条件はURLへ書くため、URLと同じ規則で正規化し、値の無い項目を除く
const searchOf = (draft: FilterDraft): ProductModerationSearch =>
  productModerationSearchAt(
    toProductModerationSearch({
      name: draft.name,
      handle: draft.handle,
      ownerHandle: draft.ownerHandle,
      category: selectedOf(draft.category),
      launchState: selectedOf(draft.launchState),
      visibility: selectedOf(draft.visibility),
    }),
    undefined,
  );

// 選択肢に無いカテゴリ(削除された・選択肢を読めない)がURLの条件に残っていても選んだ状態を示せるよう、IDのまま加える
const categoryOptionsOf = (
  categories: readonly ModerationCategoryOption[],
  selected: string | undefined,
): readonly FilterOption[] => {
  const options = categories.map(({ id, name }) => ({
    value: id,
    label: name,
  }));
  return selected === undefined ||
    options.some(({ value }) => value === selected)
    ? options
    : [...options, { value: selected, label: selected }];
};

function SearchTermField({
  id,
  label,
  value,
  tooLong,
  inputRef,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tooLong: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (value: string) => void;
}) {
  const messageId = `${id}-message`;
  return (
    <div className="flex min-w-44 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        autoComplete="off"
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={tooLong ? messageId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {tooLong ? (
        <FormMessage id={messageId}>
          {MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE}
        </FormMessage>
      ) : null}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  disabled = false,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly disabled?: boolean;
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

export function ProductFilters({
  search,
  categories,
  categoriesError,
  onApply,
  onReset,
}: ProductFiltersProps) {
  const id = useId();
  const scope = productModerationFilterScopeOf(search);
  const nameRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);
  const ownerHandleRef = useRef<HTMLInputElement>(null);
  const focusTerm = (key: SearchTermKey) => {
    const refOf = {
      name: nameRef,
      handle: handleRef,
      ownerHandle: ownerHandleRef,
    } satisfies Record<SearchTermKey, RefObject<HTMLInputElement | null>>;
    refOf[key].current?.focus();
  };
  const [edited, setEdited] = useState<{
    readonly scope: string;
    readonly pendingScope: string | undefined;
    readonly draft: FilterDraft;
    readonly tooLong: readonly SearchTermKey[];
  }>(() => ({
    scope,
    pendingScope: undefined,
    draft: draftOf(search),
    tooLong: NO_TOO_LONG_TERMS,
  }));
  // ブラウザの戻る操作などでURLの条件が外から変わったら入力欄を戻す。部品を作り直すと押した「適用」「解除」のボタンが消えてフォーカスを失うため、描画中に状態を差し替える。
  // 適用・解除した条件がURLへ届くまでの間の入力を上書きしないよう、その条件が届いた時は入力欄を戻さない
  if (edited.scope !== scope) {
    setEdited(
      edited.pendingScope === scope
        ? { ...edited, scope, pendingScope: undefined }
        : {
            scope,
            pendingScope: undefined,
            draft: draftOf(search),
            tooLong: NO_TOO_LONG_TERMS,
          },
    );
  }
  const { draft, tooLong } = edited;
  const submit = (next: ProductModerationSearch) => {
    const nextScope = productModerationFilterScopeOf(next);
    setEdited((current) => ({
      ...current,
      pendingScope: nextScope === scope ? undefined : nextScope,
      draft: draftOf(next),
      tooLong: NO_TOO_LONG_TERMS,
    }));
  };
  const update = (changes: Partial<FilterDraft>) => {
    setEdited((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
    }));
  };

  return (
    <AdminFilterBar
      onApply={() => {
        const overLimit = tooLongTermsOf(draft);
        const [firstOverLimit] = overLimit;
        if (firstOverLimit !== undefined) {
          setEdited((current) => ({ ...current, tooLong: overLimit }));
          focusTerm(firstOverLimit);
          return;
        }
        const applied = searchOf(draft);
        submit(applied);
        onApply(applied);
      }}
      onReset={() => {
        submit({});
        onReset();
      }}
    >
      <SearchTermField
        id={`${id}-name`}
        label={PRODUCT_FILTER_LABELS.name}
        value={draft.name}
        tooLong={tooLong.includes('name')}
        inputRef={nameRef}
        onChange={(name) => {
          update({ name });
        }}
      />
      <SearchTermField
        id={`${id}-handle`}
        label={PRODUCT_FILTER_LABELS.handle}
        value={draft.handle}
        tooLong={tooLong.includes('handle')}
        inputRef={handleRef}
        onChange={(handle) => {
          update({ handle });
        }}
      />
      <SearchTermField
        id={`${id}-owner-handle`}
        label={PRODUCT_FILTER_LABELS.ownerHandle}
        value={draft.ownerHandle}
        tooLong={tooLong.includes('ownerHandle')}
        inputRef={ownerHandleRef}
        onChange={(ownerHandle) => {
          update({ ownerHandle });
        }}
      />
      <FilterSelect
        id={`${id}-category`}
        label={PRODUCT_FILTER_LABELS.category}
        allLabel={PRODUCT_FILTER_LABELS.allCategories}
        value={draft.category}
        options={categoryOptionsOf(categories ?? [], search.category)}
        disabled={categories === undefined && categoriesError === undefined}
        onChange={(category) => {
          update({ category });
        }}
      />
      <FilterSelect
        id={`${id}-launch-state`}
        label={PRODUCT_FILTER_LABELS.launchState}
        allLabel={PRODUCT_FILTER_LABELS.allLaunchStates}
        value={draft.launchState}
        options={LAUNCH_STATE_OPTIONS}
        onChange={(launchState) => {
          update({ launchState });
        }}
      />
      <FilterSelect
        id={`${id}-visibility`}
        label={PRODUCT_FILTER_LABELS.visibility}
        allLabel={PRODUCT_FILTER_LABELS.allVisibilities}
        value={draft.visibility}
        options={VISIBILITY_OPTIONS}
        onChange={(visibility) => {
          update({ visibility });
        }}
      />
      {categoriesError === undefined ? null : (
        <PartialErrorState
          className="basis-full"
          message={categoriesError.message}
          onRetry={categoriesError.onRetry}
        />
      )}
    </AdminFilterBar>
  );
}
