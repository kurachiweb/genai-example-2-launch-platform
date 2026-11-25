import { useState } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import { toApiKeyScopes } from '../../graphql/public-api.ts';
import {
  API_KEY_LIST_MESSAGES,
  deleteApiKeyLabelOf,
  editApiKeyLabelOf,
  reissueApiKeyLabelOf,
} from './api-key-list-messages.ts';
import { apiKeyScopeSummaryOf } from './api-key-scope-summary.ts';

export type ApiKeyListAction = 'edit' | 'reissue' | 'delete';

export type ApiKeyDisabledActions = Readonly<
  Partial<Record<ApiKeyListAction, boolean>>
>;

export interface ApiKeyActionRequest {
  readonly action: ApiKeyListAction;
  readonly apiKey: ApiKeyFieldsFragment;
  // 開いたダイアログを閉じた後にフォーカスを戻す、押した操作
  readonly trigger: HTMLButtonElement;
}

export interface ApiKeyListItemProps {
  readonly apiKey: ApiKeyFieldsFragment;
  // 停止中は「編集」「再発行」を無効にし、「削除」は押せるままにする
  readonly disabledActions?: ApiKeyDisabledActions;
  readonly onAction: (request: ApiKeyActionRequest) => void;
}

interface ActionButtonProps {
  readonly label: string;
  readonly accessibleName: string;
  readonly disabled: boolean;
  readonly onPress: (trigger: HTMLButtonElement) => void;
}

// 操作の失敗で停止中と分かり押したボタンが無効になった時、disabledにするとChromiumがフォーカスを<body>へ落とすため、フォーカスが離れるまではaria-disabledにする
function ActionButton({
  label,
  accessibleName,
  disabled,
  onPress,
}: ActionButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={accessibleName}
      disabled={disabled && !focused}
      aria-disabled={disabled && focused ? true : undefined}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onClick={(event) => {
        if (!disabled) {
          onPress(event.currentTarget);
        }
      }}
    >
      {label}
    </Button>
  );
}

// 続きを読み込んだ後に加えた最初の項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする。同じ名前のキーは発行日時で見分ける
export function ApiKeyListItem({
  apiKey,
  disabledActions = {},
  onAction,
}: ApiKeyListItemProps) {
  const summary = apiKeyScopeSummaryOf(toApiKeyScopes(apiKey.scopes));
  const press = (action: ApiKeyListAction) => (trigger: HTMLButtonElement) => {
    onAction({ action, apiKey, trigger });
  };

  return (
    <li
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:flex-row sm:items-start sm:justify-between sm:p-5"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-base font-bold break-words">{apiKey.name}</h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">
            {API_KEY_LIST_MESSAGES.scopesLabel}
          </dt>
          <dd>
            {summary.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </dd>
          <dt className="text-muted-foreground">
            {API_KEY_LIST_MESSAGES.createdAtLabel}
          </dt>
          <dd>
            <DateTime value={apiKey.createdAt} format="longDateTime" />
          </dd>
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <ActionButton
          label={API_KEY_LIST_MESSAGES.edit}
          accessibleName={editApiKeyLabelOf(apiKey.name)}
          disabled={disabledActions.edit === true}
          onPress={press('edit')}
        />
        <ActionButton
          label={API_KEY_LIST_MESSAGES.reissue}
          accessibleName={reissueApiKeyLabelOf(apiKey.name)}
          disabled={disabledActions.reissue === true}
          onPress={press('reissue')}
        />
        <ActionButton
          label={API_KEY_LIST_MESSAGES.delete}
          accessibleName={deleteApiKeyLabelOf(apiKey.name)}
          disabled={disabledActions.delete === true}
          onPress={press('delete')}
        />
      </div>
    </li>
  );
}
