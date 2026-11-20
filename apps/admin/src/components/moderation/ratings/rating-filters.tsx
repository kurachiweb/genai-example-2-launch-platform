import { type RefObject, useId, useRef, useState } from 'react';

import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { AdminFilterBar } from '../../../../lib/components/admin/admin-filter-bar.tsx';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { Input } from '../../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../../lib/components/ui/select/select-value.tsx';
import {
  MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE,
  RATING_FILTER_LABELS,
  RATING_STATE_LABELS,
} from '../shared/moderation-messages.ts';
import {
  ADMIN_RATING_STATE_VALUES,
  MODERATION_SEARCH_TERM_MAX,
  type RatingModerationSearch,
  ratingModerationFilterScopeOf,
  toRatingModerationSearch,
} from '../shared/moderation-search.ts';

export interface RatingFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: RatingModerationSearch;
  readonly onApply: (search: RatingModerationSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly productHandle: string;
  readonly raterHandle: string;
  readonly state: string;
}

type SearchTermKey = Exclude<keyof FilterDraft, 'state'>;

const SEARCH_TERM_KEYS: readonly SearchTermKey[] = Object.freeze([
  'productHandle',
  'raterHandle',
]);

const NO_TOO_LONG_TERMS: readonly SearchTermKey[] = Object.freeze([]);

// 正規化と同じく前後の空白を除いた語の書記素数で数える
const tooLongTermsOf = (draft: FilterDraft): readonly SearchTermKey[] =>
  SEARCH_TERM_KEYS.filter(
    (key) =>
      countGraphemes(trimWhiteSpace(draft[key])) > MODERATION_SEARCH_TERM_MAX,
  );

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には状態の値になり得ない値を使う
const ALL_VALUE = '*';

const draftOf = (search: RatingModerationSearch): FilterDraft => ({
  productHandle: search.productHandle ?? '',
  raterHandle: search.raterHandle ?? '',
  state: search.state ?? ALL_VALUE,
});

// 入力はURLの条件と同じ正規化に通し、空の値と不正な値を未指定にして、ページの位置を最初に戻す
const searchOf = (draft: FilterDraft): RatingModerationSearch =>
  toRatingModerationSearch({
    productHandle: draft.productHandle,
    raterHandle: draft.raterHandle,
    state: draft.state,
  });

function SearchTermFilter({
  id,
  label,
  value,
  error,
  inputRef,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-48 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === undefined ? null : (
        <FormMessage id={errorId}>{error}</FormMessage>
      )}
    </div>
  );
}

export function RatingFilters({
  search,
  onApply,
  onReset,
}: RatingFiltersProps) {
  const id = useId();
  const scope = ratingModerationFilterScopeOf(search);
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
  const productHandleRef = useRef<HTMLInputElement>(null);
  const raterHandleRef = useRef<HTMLInputElement>(null);
  // ブラウザの戻る操作などでURLの条件が外から変わったら入力欄を戻す。部品を作り直すと押した「適用」「解除」のボタンが消えてフォーカスを失うため、描画中に状態を差し替える。
  // 適用・解除した条件がURLへ届くのは読み込みの後のため、届くまでの間の入力を上書きしないよう、その条件が届いた時は入力欄を戻さない
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
  const submit = (next: RatingModerationSearch) => {
    const nextScope = ratingModerationFilterScopeOf(next);
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
  const searchTermFilter = (key: SearchTermKey) => ({
    id: `${id}-${key}`,
    label: RATING_FILTER_LABELS[key],
    value: draft[key],
    error: tooLong.includes(key)
      ? MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE
      : undefined,
    onChange: (value: string) => {
      update({ [key]: value });
    },
  });

  return (
    <AdminFilterBar
      onApply={() => {
        const overflowing = tooLongTermsOf(draft);
        const [first] = overflowing;
        if (first !== undefined) {
          setEdited((current) => ({ ...current, tooLong: overflowing }));
          (first === 'productHandle'
            ? productHandleRef
            : raterHandleRef
          ).current?.focus();
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
      <SearchTermFilter
        {...searchTermFilter('productHandle')}
        inputRef={productHandleRef}
      />
      <SearchTermFilter
        {...searchTermFilter('raterHandle')}
        inputRef={raterHandleRef}
      />
      <div className="flex min-w-40 flex-col gap-2">
        <Label htmlFor={`${id}-state`}>{RATING_FILTER_LABELS.state}</Label>
        <Select
          value={draft.state}
          onValueChange={(state) => {
            update({ state });
          }}
        >
          <SelectTrigger id={`${id}-state`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>
              {RATING_FILTER_LABELS.allStates}
            </SelectItem>
            {ADMIN_RATING_STATE_VALUES.map((state) => (
              <SelectItem key={state} value={state}>
                {RATING_STATE_LABELS[state]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </AdminFilterBar>
  );
}
