import { type RefObject, useId, useRef, useState } from 'react';

import {
  REPORT_CASE_STATUS_LABELS,
  REPORT_TARGET_KIND_LABELS,
} from '../../../../common-lib/reporting/report-labels.ts';
import { AdminFilterBar } from '../../../../lib/components/admin/admin-filter-bar.tsx';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { Input } from '../../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../../lib/components/ui/select/select-value.tsx';
import type { ReportCategoryOption } from '../../../graphql/admin-reporting-categories.ts';
import {
  PERIOD_ORDER_MESSAGE,
  PERIOD_RANGE_MESSAGE,
} from '../../audit/audit-logs-messages.ts';
import {
  type AuditPeriodFieldError,
  type AuditPeriodInputErrors,
  checkAuditPeriodInput,
} from '../../audit/audit-period.ts';
import {
  REPORT_SEARCH_STATUS_OF,
  REPORT_SEARCH_STATUSES,
  REPORT_SEARCH_TARGET_OF,
  REPORT_SEARCH_TARGETS,
  type ReportSearch,
  reportCaseFilterScopeOf,
  toReportSearch,
  withReportSearchFilters,
} from '../shared/report-search.ts';
import { REPORT_FILTER_LABELS } from './report-list-messages.ts';

export interface ReportCaseFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: ReportSearch;
  // undefinedは選択肢の読み込み中
  readonly categories: readonly ReportCategoryOption[] | undefined;
  readonly onApply: (search: ReportSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly status: string;
  readonly target: string;
  readonly category: string;
  readonly from: string;
  readonly to: string;
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には状態・種類・カテゴリのIDになり得ない値を使う
const ALL_VALUE = '*';

const STATUS_OPTIONS: readonly FilterOption[] = Object.freeze(
  REPORT_SEARCH_STATUSES.map((status) => ({
    value: status,
    label: REPORT_CASE_STATUS_LABELS[REPORT_SEARCH_STATUS_OF[status]],
  })),
);

const TARGET_OPTIONS: readonly FilterOption[] = Object.freeze(
  REPORT_SEARCH_TARGETS.map((target) => ({
    value: target,
    label: REPORT_TARGET_KIND_LABELS[REPORT_SEARCH_TARGET_OF[target]],
  })),
);

const PERIOD_MESSAGES: Readonly<Record<AuditPeriodFieldError, string>> =
  Object.freeze({
    'out-of-range': PERIOD_RANGE_MESSAGE,
    reversed: PERIOD_ORDER_MESSAGE,
  });

const NO_PERIOD_ERRORS: AuditPeriodInputErrors = Object.freeze({});

const draftOf = (search: ReportSearch): FilterDraft => ({
  status: search.status ?? ALL_VALUE,
  target: search.target ?? ALL_VALUE,
  category: search.category ?? ALL_VALUE,
  from: search.from ?? '',
  to: search.to ?? '',
});

// 入力はURLの条件と同じ正規化に通し、条件を付けない選択肢と空の値を未指定にして、ページの位置を最初に戻す
const searchOf = (draft: FilterDraft): ReportSearch =>
  withReportSearchFilters({}, toReportSearch({ ...draft }));

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
      <Select value={value} onValueChange={onChange} disabled={disabled}>
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

export function ReportCaseFilters({
  search,
  categories,
  onApply,
  onReset,
}: ReportCaseFiltersProps) {
  const id = useId();
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const scope = reportCaseFilterScopeOf(search);
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
  const submit = (next: ReportSearch) => {
    const nextScope = reportCaseFilterScopeOf(next);
    setEdited((current) => ({
      ...current,
      pendingScope: nextScope === scope ? undefined : nextScope,
      draft: draftOf(next),
      periodErrors: NO_PERIOD_ERRORS,
    }));
  };
  const update = (changes: Partial<FilterDraft>) => {
    setEdited((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
    }));
  };
  const categoryOptions: readonly FilterOption[] = (categories ?? []).map(
    ({ id: value, name }) => ({ value, label: name }),
  );

  return (
    <AdminFilterBar
      onApply={() => {
        const errors = checkAuditPeriodInput(draft);
        if (errors.from !== undefined || errors.to !== undefined) {
          setEdited((current) => ({ ...current, periodErrors: errors }));
          (errors.from === undefined
            ? toInputRef
            : fromInputRef
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
      <FilterSelect
        id={`${id}-status`}
        label={REPORT_FILTER_LABELS.status}
        allLabel={REPORT_FILTER_LABELS.allStatuses}
        value={draft.status}
        options={STATUS_OPTIONS}
        onChange={(status) => {
          update({ status });
        }}
      />
      <FilterSelect
        id={`${id}-target`}
        label={REPORT_FILTER_LABELS.target}
        allLabel={REPORT_FILTER_LABELS.allTargets}
        value={draft.target}
        options={TARGET_OPTIONS}
        onChange={(target) => {
          update({ target });
        }}
      />
      <FilterSelect
        id={`${id}-category`}
        label={REPORT_FILTER_LABELS.category}
        allLabel={REPORT_FILTER_LABELS.allCategories}
        value={draft.category}
        options={categoryOptions}
        disabled={categories === undefined}
        onChange={(category) => {
          update({ category });
        }}
      />
      <PeriodField
        id={`${id}-from`}
        label={REPORT_FILTER_LABELS.from}
        value={draft.from}
        error={periodErrors.from}
        inputRef={fromInputRef}
        onChange={(from) => {
          update({ from });
        }}
      />
      <PeriodField
        id={`${id}-to`}
        label={REPORT_FILTER_LABELS.to}
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
