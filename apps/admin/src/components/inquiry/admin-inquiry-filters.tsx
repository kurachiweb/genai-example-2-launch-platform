import { type RefObject, useId, useRef, useState } from 'react';

import { INQUIRY_STATUS_LABELS } from '../../../common-lib/inquiry/inquiry-status.ts';
import { AdminFilterBar } from '../../../lib/components/admin/admin-filter-bar.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import {
  INQUIRY_KIND_OF,
  INQUIRY_STATUS_OF,
  type InquiryCategoryOption,
} from '../../graphql/admin-inquiries.ts';
import type {
  InquiryKind,
  InquiryStatus,
} from '../../graphql/generated/graphql.ts';
import {
  PERIOD_ORDER_MESSAGE,
  PERIOD_RANGE_MESSAGE,
} from '../audit/audit-logs-messages.ts';
import {
  type AuditPeriodFieldError,
  type AuditPeriodInputErrors,
  checkAuditPeriodInput,
} from '../audit/audit-period.ts';
import {
  ALL_CATEGORIES_LABEL,
  ALL_KINDS_LABEL,
  ALL_STATUSES_LABEL,
  CATEGORY_FILTER_LABEL,
  INQUIRY_KIND_LABELS,
  KIND_FILTER_LABEL,
  RECEIVED_FROM_FILTER_LABEL,
  RECEIVED_TO_FILTER_LABEL,
  STATUS_FILTER_LABEL,
} from './admin-inquiries-messages.ts';
import {
  ADMIN_INQUIRY_KINDS,
  ADMIN_INQUIRY_STATUSES,
  type AdminInquirySearch,
  adminInquiryFilterScopeOf,
} from './admin-inquiry-search.ts';

export interface AdminInquiryFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: AdminInquirySearch;
  readonly categories: readonly InquiryCategoryOption[];
  readonly onApply: (search: AdminInquirySearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly status: string;
  readonly kind: string;
  readonly category: string;
  readonly from: string;
  readonly to: string;
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢にはステータス・種別・カテゴリのIDになり得ない値を使う
const ALL_VALUE = '*';

const STATUS_OPTIONS: readonly FilterOption[] = ADMIN_INQUIRY_STATUSES.map(
  (status) => ({
    value: status,
    label: INQUIRY_STATUS_LABELS[INQUIRY_STATUS_OF[status]],
  }),
);

const KIND_OPTIONS: readonly FilterOption[] = ADMIN_INQUIRY_KINDS.map(
  (kind) => ({
    value: kind,
    label: INQUIRY_KIND_LABELS[INQUIRY_KIND_OF[kind]],
  }),
);

const isStatus = (value: string): value is InquiryStatus =>
  (ADMIN_INQUIRY_STATUSES as readonly string[]).includes(value);

const isKind = (value: string): value is InquiryKind =>
  (ADMIN_INQUIRY_KINDS as readonly string[]).includes(value);

const draftOf = (search: AdminInquirySearch): FilterDraft => ({
  status: search.status ?? ALL_VALUE,
  kind: search.kind ?? ALL_VALUE,
  category: search.category ?? ALL_VALUE,
  from: search.from ?? '',
  to: search.to ?? '',
});

const searchOf = (draft: FilterDraft): AdminInquirySearch => ({
  ...(isStatus(draft.status) && { status: draft.status }),
  ...(isKind(draft.kind) && { kind: draft.kind }),
  ...(draft.category !== ALL_VALUE && { category: draft.category }),
  ...(draft.from !== '' && { from: draft.from }),
  ...(draft.to !== '' && { to: draft.to }),
});

const PERIOD_MESSAGES: Readonly<Record<AuditPeriodFieldError, string>> =
  Object.freeze({
    'out-of-range': PERIOD_RANGE_MESSAGE,
    reversed: PERIOD_ORDER_MESSAGE,
  });

const NO_PERIOD_ERRORS: AuditPeriodInputErrors = Object.freeze({});

function PeriodField({
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
  readonly error: AuditPeriodFieldError | undefined;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (value: string) => void;
}) {
  const messageId = `${id}-message`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={inputRef}
        id={id}
        type="date"
        value={value}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : messageId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === undefined ? null : (
        <FormMessage id={messageId}>{PERIOD_MESSAGES[error]}</FormMessage>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-44 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
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

export function AdminInquiryFilters({
  search,
  categories,
  onApply,
  onReset,
}: AdminInquiryFiltersProps) {
  const id = useId();
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const scope = adminInquiryFilterScopeOf(search);
  const [edited, setEdited] = useState<{
    readonly scope: string;
    readonly pendingScope: string | undefined;
    readonly draft: FilterDraft;
    readonly periodErrors: AuditPeriodInputErrors;
  }>(() => ({
    scope,
    pendingScope: undefined,
    draft: draftOf(search),
    periodErrors: NO_PERIOD_ERRORS,
  }));
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
            periodErrors: NO_PERIOD_ERRORS,
          },
    );
  }
  const { draft, periodErrors } = edited;
  // 削除されたカテゴリがURLの条件に残っていても選んだ状態を示せるよう、選択肢に無いIDはIDのまま加える
  const categoryOptions =
    search.category === undefined ||
    categories.some(({ value }) => value === search.category)
      ? categories
      : [...categories, { value: search.category, label: search.category }];
  const pendingScopeOf = (next: AdminInquirySearch): string | undefined => {
    const nextScope = adminInquiryFilterScopeOf(next);
    return nextScope === scope ? undefined : nextScope;
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
        const errors = checkAuditPeriodInput(draft);
        setEdited((current) => ({ ...current, periodErrors: errors }));
        if (errors.from !== undefined) {
          fromInputRef.current?.focus();
          return;
        }
        if (errors.to !== undefined) {
          toInputRef.current?.focus();
          return;
        }
        const applied = searchOf(draft);
        setEdited((current) => ({
          ...current,
          pendingScope: pendingScopeOf(applied),
          draft: draftOf(applied),
        }));
        onApply(applied);
      }}
      onReset={() => {
        setEdited((current) => ({
          ...current,
          pendingScope: pendingScopeOf({}),
          draft: draftOf({}),
          periodErrors: NO_PERIOD_ERRORS,
        }));
        onReset();
      }}
    >
      <FilterSelect
        id={`${id}-status`}
        label={STATUS_FILTER_LABEL}
        allLabel={ALL_STATUSES_LABEL}
        value={draft.status}
        options={STATUS_OPTIONS}
        onChange={(status) => {
          update({ status });
        }}
      />
      <FilterSelect
        id={`${id}-kind`}
        label={KIND_FILTER_LABEL}
        allLabel={ALL_KINDS_LABEL}
        value={draft.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => {
          update({ kind });
        }}
      />
      <FilterSelect
        id={`${id}-category`}
        label={CATEGORY_FILTER_LABEL}
        allLabel={ALL_CATEGORIES_LABEL}
        value={draft.category}
        options={categoryOptions}
        onChange={(category) => {
          update({ category });
        }}
      />
      <PeriodField
        id={`${id}-from`}
        label={RECEIVED_FROM_FILTER_LABEL}
        value={draft.from}
        error={periodErrors.from}
        inputRef={fromInputRef}
        onChange={(from) => {
          update({ from });
        }}
      />
      <PeriodField
        id={`${id}-to`}
        label={RECEIVED_TO_FILTER_LABEL}
        value={draft.to}
        error={periodErrors.to}
        inputRef={toInputRef}
        onChange={(to) => {
          update({ to });
        }}
      />
    </AdminFilterBar>
  );
}
