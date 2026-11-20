import { type RefObject, useId, useRef, useState } from 'react';

import { EMAIL_MAX_LENGTH } from '../../../../common-lib/identity/account-input-rules.ts';
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
  EMAIL_SEARCH_AUDIT_NOTICE,
  MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE,
  USER_FILTER_LABELS,
  USER_STATUS_LABELS,
} from '../shared/moderation-messages.ts';
import {
  ADMIN_USER_STATUS_VALUES,
  MODERATION_SEARCH_TERM_MAX,
  toUserModerationSearch,
  type UserModerationSearch,
  userModerationFilterScopeOf,
} from '../shared/moderation-search.ts';

export interface UserFiltersProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、入力欄をその値に戻す
  readonly search: UserModerationSearch;
  readonly onApply: (search: UserModerationSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
  readonly status: string;
}

type TextFilterKey = Exclude<keyof FilterDraft, 'status'>;

type SearchTermKey = Exclude<TextFilterKey, 'email'>;

// メールアドレスの欄は入力の上限で上限を超えて入力できないため、検索語の上限は部分一致の欄だけで確かめる
const SEARCH_TERM_KEYS: readonly SearchTermKey[] = Object.freeze([
  'handle',
  'nickname',
]);

const NO_TOO_LONG_TERMS: readonly SearchTermKey[] = Object.freeze([]);

// 正規化と同じく前後の空白を除いた語の書記素数で数える
const tooLongTermsOf = (draft: FilterDraft): readonly SearchTermKey[] =>
  SEARCH_TERM_KEYS.filter(
    (key) =>
      countGraphemes(trimWhiteSpace(draft[key])) > MODERATION_SEARCH_TERM_MAX,
  );

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には停止状態の値になり得ない値を使う
const ALL_VALUE = '*';

const draftOf = (search: UserModerationSearch): FilterDraft => ({
  handle: search.handle ?? '',
  nickname: search.nickname ?? '',
  email: search.email ?? '',
  status: search.status ?? ALL_VALUE,
});

// 入力はURLの条件と同じ正規化に通し、空の値と不正な値を未指定にして、ページの位置を最初に戻す
const searchOf = (draft: FilterDraft): UserModerationSearch =>
  toUserModerationSearch({
    handle: draft.handle,
    nickname: draft.nickname,
    email: draft.email,
    status: draft.status,
  });

function TextFilter({
  id,
  label,
  value,
  descriptionId,
  error,
  inputRef,
  inputMode,
  maxLength,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly descriptionId?: string;
  readonly error?: string;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly inputMode?: 'email';
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const describedBy = [descriptionId, error === undefined ? undefined : errorId]
    .filter((part) => part !== undefined)
    .join(' ');
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
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
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

export function UserFilters({ search, onApply, onReset }: UserFiltersProps) {
  const id = useId();
  const scope = userModerationFilterScopeOf(search);
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
  const handleInputRef = useRef<HTMLInputElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
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
  const emailNoticeId = `${id}-email-notice`;
  const submit = (next: UserModerationSearch) => {
    const nextScope = userModerationFilterScopeOf(next);
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
  const textFilter = (key: TextFilterKey) => ({
    id: `${id}-${key}`,
    label: USER_FILTER_LABELS[key],
    value: draft[key],
    onChange: (value: string) => {
      update({ [key]: value });
    },
  });
  const searchTermFilter = (key: SearchTermKey) => ({
    ...textFilter(key),
    ...(tooLong.includes(key)
      ? { error: MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE }
      : {}),
  });

  return (
    <AdminFilterBar
      onApply={() => {
        const overflowing = tooLongTermsOf(draft);
        const [first] = overflowing;
        if (first !== undefined) {
          setEdited((current) => ({ ...current, tooLong: overflowing }));
          (first === 'handle'
            ? handleInputRef
            : nicknameInputRef
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
      <TextFilter {...searchTermFilter('handle')} inputRef={handleInputRef} />
      <TextFilter
        {...searchTermFilter('nickname')}
        inputRef={nicknameInputRef}
      />
      <div className="flex flex-col gap-2">
        <TextFilter
          {...textFilter('email')}
          inputMode="email"
          maxLength={EMAIL_MAX_LENGTH}
          descriptionId={emailNoticeId}
        />
        <p id={emailNoticeId} className="text-sm text-muted-foreground">
          {EMAIL_SEARCH_AUDIT_NOTICE}
        </p>
      </div>
      <div className="flex min-w-36 flex-col gap-2">
        <Label htmlFor={`${id}-status`}>{USER_FILTER_LABELS.status}</Label>
        <Select
          value={draft.status}
          onValueChange={(status) => {
            update({ status });
          }}
        >
          <SelectTrigger id={`${id}-status`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>
              {USER_FILTER_LABELS.allStatuses}
            </SelectItem>
            {ADMIN_USER_STATUS_VALUES.map((status) => (
              <SelectItem key={status} value={status}>
                {USER_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </AdminFilterBar>
  );
}
