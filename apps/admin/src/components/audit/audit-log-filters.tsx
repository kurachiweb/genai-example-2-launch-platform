import { type RefObject, useId, useRef, useState } from 'react';

import { AUDIT_FILTER_TEXT_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import { AdminFilterBar } from '../../../lib/components/admin/admin-filter-bar.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import type { AuditLogFilterOption } from './audit-log-filter-options.ts';
import {
  type AuditLogSearch,
  auditLogFilterScopeOf,
  normalizeTargetId,
} from './audit-log-search.ts';
import {
  ACTION_FILTER_LABEL,
  ALL_ACTIONS_LABEL,
  ALL_OPERATORS_LABEL,
  FROM_FILTER_LABEL,
  OPERATOR_FILTER_LABEL,
  PERIOD_ORDER_MESSAGE,
  PERIOD_RANGE_MESSAGE,
  TARGET_FILTER_DESCRIPTION,
  TARGET_FILTER_LABEL,
  TO_FILTER_LABEL,
} from './audit-logs-messages.ts';
import {
  type AuditPeriodFieldError,
  type AuditPeriodInputErrors,
  checkAuditPeriodInput,
} from './audit-period.ts';

export interface AuditLogFiltersProps {
  // URLの条件。変わったら入力欄をその値に戻す
  readonly search: AuditLogSearch;
  readonly operators: readonly AuditLogFilterOption[];
  readonly actions: readonly AuditLogFilterOption[];
  readonly onApply: (search: AuditLogSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly operator: string;
  readonly action: string;
  readonly target: string;
  readonly from: string;
  readonly to: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には操作者のIDや操作種別の名前になり得ない値を使う
const ALL_VALUE = '*';

const draftOf = (search: AuditLogSearch): FilterDraft => ({
  operator: search.operator ?? ALL_VALUE,
  action: search.action ?? ALL_VALUE,
  target: search.target ?? '',
  from: search.from ?? '',
  to: search.to ?? '',
});

const searchOf = (draft: FilterDraft): AuditLogSearch => {
  const target = normalizeTargetId(draft.target);
  return {
    ...(draft.operator !== ALL_VALUE && { operator: draft.operator }),
    ...(draft.action !== ALL_VALUE && { action: draft.action }),
    ...(target !== '' && { target }),
    ...(draft.from !== '' && { from: draft.from }),
    ...(draft.to !== '' && { to: draft.to }),
  };
};

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
  readonly options: readonly AuditLogFilterOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-48 flex-col gap-2">
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

export function AuditLogFilters({
  search,
  operators,
  actions,
  onApply,
  onReset,
}: AuditLogFiltersProps) {
  const id = useId();
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const scope = auditLogFilterScopeOf(search);
  const [edited, setEdited] = useState(() => ({
    scope,
    draft: draftOf(search),
    periodErrors: NO_PERIOD_ERRORS,
  }));
  // 適用・解除・ブラウザの戻る操作でURLの条件が変わったら入力欄を戻す。部品を作り直すと押した「適用」「解除」のボタンが消えてフォーカスを失うため、描画中に状態を差し替える
  if (edited.scope !== scope) {
    setEdited({
      scope,
      draft: draftOf(search),
      periodErrors: NO_PERIOD_ERRORS,
    });
  }
  const { draft, periodErrors } = edited;
  const ids = {
    operator: `${id}-operator`,
    action: `${id}-action`,
    target: `${id}-target`,
    targetDescription: `${id}-target-description`,
    from: `${id}-from`,
    to: `${id}-to`,
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
        onApply(searchOf(draft));
      }}
      onReset={() => {
        setEdited((current) => ({
          ...current,
          draft: draftOf({}),
          periodErrors: NO_PERIOD_ERRORS,
        }));
        onReset();
      }}
    >
      <FilterSelect
        id={ids.operator}
        label={OPERATOR_FILTER_LABEL}
        allLabel={ALL_OPERATORS_LABEL}
        value={draft.operator}
        options={operators}
        onChange={(operator) => {
          update({ operator });
        }}
      />
      <FilterSelect
        id={ids.action}
        label={ACTION_FILTER_LABEL}
        allLabel={ALL_ACTIONS_LABEL}
        value={draft.action}
        options={actions}
        onChange={(action) => {
          update({ action });
        }}
      />
      <div className="flex min-w-64 flex-col gap-2">
        <Label htmlFor={ids.target}>{TARGET_FILTER_LABEL}</Label>
        <Input
          id={ids.target}
          value={draft.target}
          maxLength={AUDIT_FILTER_TEXT_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={ids.targetDescription}
          className="font-mono"
          onChange={(event) => {
            update({ target: event.target.value });
          }}
        />
        <p id={ids.targetDescription} className="text-sm text-muted-foreground">
          {TARGET_FILTER_DESCRIPTION}
        </p>
      </div>
      <PeriodField
        id={ids.from}
        label={FROM_FILTER_LABEL}
        value={draft.from}
        error={periodErrors.from}
        inputRef={fromInputRef}
        onChange={(from) => {
          update({ from });
        }}
      />
      <PeriodField
        id={ids.to}
        label={TO_FILTER_LABEL}
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
