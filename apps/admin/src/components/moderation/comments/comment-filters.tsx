import { type RefObject, useId, useRef, useState } from 'react';

import {
  ADMIN_COMMENT_STATE_LABELS,
  type AdminCommentState,
} from '../../../../common-lib/moderation/moderation-labels.ts';
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
  PERIOD_ORDER_MESSAGE,
  PERIOD_RANGE_MESSAGE,
} from '../../audit/audit-logs-messages.ts';
import {
  type AuditPeriodFieldError,
  checkAuditPeriodInput,
} from '../../audit/audit-period.ts';
import {
  COMMENT_FILTER_LABELS,
  MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE,
} from '../shared/moderation-messages.ts';
import {
  type CommentModerationSearch,
  commentModerationFilterScopeOf,
  MODERATION_SEARCH_TERM_MAX,
  toCommentModerationSearch,
} from '../shared/moderation-search.ts';

export interface CommentFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: CommentModerationSearch;
  readonly onApply: (search: CommentModerationSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly authorHandle: string;
  readonly productHandle: string;
  readonly from: string;
  readonly to: string;
  readonly state: string;
}

type SearchTermKey = 'authorHandle' | 'productHandle';

type PeriodKey = 'from' | 'to';

type FieldKey = SearchTermKey | PeriodKey;

const SEARCH_TERM_KEYS: readonly SearchTermKey[] = Object.freeze([
  'authorHandle',
  'productHandle',
]);

// 文言規則のコメントの状態の表示名の並び
const STATE_OPTIONS: readonly AdminCommentState[] = Object.freeze([
  'shown',
  'hidden',
  'deleted',
  'anonymized',
  'author_unavailable',
]);

const PERIOD_MESSAGES: Readonly<Record<AuditPeriodFieldError, string>> =
  Object.freeze({
    'out-of-range': PERIOD_RANGE_MESSAGE,
    reversed: PERIOD_ORDER_MESSAGE,
  });

type FieldErrors = Readonly<Partial<Record<FieldKey, string>>>;

const NO_ERRORS: FieldErrors = Object.freeze({});

// 誤りを示す欄の並び。最初の誤りの欄へフォーカスを移す
const FIELD_ORDER: readonly FieldKey[] = Object.freeze([
  'authorHandle',
  'productHandle',
  'from',
  'to',
]);

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には状態の値になり得ない値を使う
const ALL_VALUE = '*';

const draftOf = (search: CommentModerationSearch): FilterDraft => ({
  authorHandle: search.authorHandle ?? '',
  productHandle: search.productHandle ?? '',
  from: search.from ?? '',
  to: search.to ?? '',
  state: search.state ?? ALL_VALUE,
});

// 検索語は正規化と同じく前後の空白を除いた語の書記素数で数える。期間は監査ログと同じ規則で、開始日より前の終了日を拒む
const errorsOf = (draft: FilterDraft): FieldErrors => {
  const period = checkAuditPeriodInput(draft);
  return Object.fromEntries([
    ...SEARCH_TERM_KEYS.flatMap((key) =>
      countGraphemes(trimWhiteSpace(draft[key])) > MODERATION_SEARCH_TERM_MAX
        ? [[key, MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE]]
        : [],
    ),
    ...(['from', 'to'] as const).flatMap((key) => {
      const error = period[key];
      return error === undefined ? [] : [[key, PERIOD_MESSAGES[error]]];
    }),
  ]) as FieldErrors;
};

// 入力はURLの条件と同じ正規化に通し、空の値と不正な値を未指定にして、ページの位置を最初に戻す
const searchOf = (draft: FilterDraft): CommentModerationSearch =>
  toCommentModerationSearch({
    authorHandle: draft.authorHandle,
    productHandle: draft.productHandle,
    from: draft.from,
    to: draft.to,
    state: draft.state,
  });

function FilterField({
  id,
  label,
  value,
  type,
  error,
  inputRef,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly type: 'text' | 'date';
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
        type={type}
        value={value}
        {...(type === 'text' ? { autoComplete: 'off', spellCheck: false } : {})}
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

export function CommentFilters({
  search,
  onApply,
  onReset,
}: CommentFiltersProps) {
  const id = useId();
  const scope = commentModerationFilterScopeOf(search);
  const [edited, setEdited] = useState<{
    readonly scope: string;
    readonly pendingScope: string | undefined;
    readonly draft: FilterDraft;
    readonly errors: FieldErrors;
  }>(() => ({
    scope,
    pendingScope: undefined,
    draft: draftOf(search),
    errors: NO_ERRORS,
  }));
  const authorHandleRef = useRef<HTMLInputElement>(null);
  const productHandleRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
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
            errors: NO_ERRORS,
          },
    );
  }
  const { draft, errors } = edited;
  const submit = (next: CommentModerationSearch) => {
    const nextScope = commentModerationFilterScopeOf(next);
    setEdited((current) => ({
      ...current,
      pendingScope: nextScope === scope ? undefined : nextScope,
      draft: draftOf(next),
      errors: NO_ERRORS,
    }));
  };
  const field = (key: FieldKey, type: 'text' | 'date') => ({
    id: `${id}-${key}`,
    label: COMMENT_FILTER_LABELS[key],
    value: draft[key],
    type,
    error: errors[key],
    onChange: (value: string) => {
      setEdited((current) => ({
        ...current,
        draft: { ...current.draft, [key]: value },
      }));
    },
  });

  return (
    <AdminFilterBar
      onApply={() => {
        const found = errorsOf(draft);
        const first = FIELD_ORDER.find((key) => found[key] !== undefined);
        if (first !== undefined) {
          setEdited((current) => ({ ...current, errors: found }));
          const inputRefs: Readonly<
            Record<FieldKey, RefObject<HTMLInputElement | null>>
          > = {
            authorHandle: authorHandleRef,
            productHandle: productHandleRef,
            from: fromRef,
            to: toRef,
          };
          inputRefs[first].current?.focus();
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
      <FilterField
        {...field('authorHandle', 'text')}
        inputRef={authorHandleRef}
      />
      <FilterField
        {...field('productHandle', 'text')}
        inputRef={productHandleRef}
      />
      <FilterField {...field('from', 'date')} inputRef={fromRef} />
      <FilterField {...field('to', 'date')} inputRef={toRef} />
      <div className="flex min-w-48 flex-col gap-2">
        <Label htmlFor={`${id}-state`}>{COMMENT_FILTER_LABELS.state}</Label>
        <Select
          value={draft.state}
          onValueChange={(state) => {
            setEdited((current) => ({
              ...current,
              draft: { ...current.draft, state },
            }));
          }}
        >
          <SelectTrigger id={`${id}-state`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>
              {COMMENT_FILTER_LABELS.allStates}
            </SelectItem>
            {STATE_OPTIONS.map((state) => (
              <SelectItem key={state} value={state}>
                {ADMIN_COMMENT_STATE_LABELS[state]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </AdminFilterBar>
  );
}
