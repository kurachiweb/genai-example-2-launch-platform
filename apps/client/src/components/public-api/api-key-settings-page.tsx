import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import {
  deleteApiKeyMutationOptions,
  invalidateMyApiKeys,
  issueApiKeyMutationOptions,
  type MyApiKeysData,
  myApiKeysQueryOptions,
  reissueApiKeyMutationOptions,
  updateApiKeyMutationOptions,
} from '../../graphql/public-api.ts';
import { SUSPENDED_NOTICE_LABEL } from '../settings/settings-messages.ts';
import {
  ApiKeyConfirmDialog,
  type ApiKeyConfirmTarget,
} from './api-key-confirm-dialog.tsx';
import {
  ApiKeyFormDialog,
  type ApiKeyFormRequest,
  type ApiKeyFormTarget,
} from './api-key-form-dialog.tsx';
import type {
  ApiKeyActionRequest,
  ApiKeyDisabledActions,
} from './api-key-list-item.tsx';
import { API_DOCS_HREF } from './api-key-list-messages.ts';
import { ApiKeyList } from './api-key-list.tsx';
import {
  API_KEY_SETTINGS_MESSAGES,
  API_KEY_SETTINGS_PAGE_TITLE,
} from './api-key-settings-messages.ts';
import { IssuedApiKeyDialog } from './issued-api-key-dialog.tsx';

export interface ApiKeySettingsPageProps {
  readonly viewerId: string;
  // 読み込んだ時点で停止中か。操作の拒否で停止中と分かった時も同じ表示にする
  readonly suspended: boolean;
}

type FocusTarget = RefObject<HTMLElement | null>;

// 閉じるダイアログの後ろで別のダイアログが開く時は、フォーカスを動かさず開いたダイアログの中に残す
const KEEP_FOCUS: FocusTarget = Object.freeze({ current: null });

const focusTargetOf = (element: HTMLElement): FocusTarget => ({
  current: element,
});

const SUSPENDED_DISABLED_ACTIONS: ApiKeyDisabledActions = Object.freeze({
  edit: true,
  reissue: true,
});

const toApiKeys = (data: MyApiKeysData): readonly ApiKeyFieldsFragment[] =>
  data.pages.flatMap(({ myApiKeys }) => myApiKeys.nodes);

const failedWith = (error: unknown, code: string): boolean =>
  error instanceof GraphQLClientError && error.code === code;

interface SuspendedNoticeProps {
  readonly noticeRef: RefObject<HTMLDivElement | null>;
}

// 操作の拒否で停止中と分かりダイアログを閉じた時に理由を読ませるため、フォーカスの移り先にできるようにする
function SuspendedNotice({ noticeRef }: SuspendedNoticeProps) {
  return (
    <div
      ref={noticeRef}
      role="note"
      aria-label={SUSPENDED_NOTICE_LABEL}
      tabIndex={-1}
      className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p>{API_KEY_SETTINGS_MESSAGES.suspendedNotice}</p>
    </div>
  );
}

// 自分のAPIキーの一覧と、発行・編集・再発行・削除の操作を結ぶ。平文は平文のダイアログの状態にだけ置き、変更の結果とキャッシュに残さない
export function ApiKeySettingsPage({
  viewerId,
  suspended: suspendedOnLoad,
}: ApiKeySettingsPageProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const issueButtonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    ...myApiKeysQueryOptions(viewerId),
    select: toApiKeys,
  });
  const issueMutation = useMutation(issueApiKeyMutationOptions());
  const updateMutation = useMutation(updateApiKeyMutationOptions());
  const reissueMutation = useMutation(reissueApiKeyMutationOptions());
  const deleteMutation = useMutation(deleteApiKeyMutationOptions());

  const [suspensionFound, setSuspensionFound] = useState(false);
  const suspended = suspendedOnLoad || suspensionFound;
  const [formTarget, setFormTarget] = useState<ApiKeyFormTarget | null>(null);
  const [formReturn, setFormReturn] = useState<FocusTarget>(KEEP_FOCUS);
  const [confirmTarget, setConfirmTarget] =
    useState<ApiKeyConfirmTarget | null>(null);
  const [confirmReturn, setConfirmReturn] = useState<FocusTarget>(KEEP_FOCUS);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [issuedReturn, setIssuedReturn] = useState<FocusTarget>(KEEP_FOCUS);

  const refreshList = () => invalidateMyApiKeys(queryClient);

  // 対象のキーが無くなった時と停止中と分かった時は、押したボタンが消える・無効になるため、閉じた後のフォーカスを残る要素へ移す。扱った失敗なら真を返す
  const settleKnownFailure = async (
    error: unknown,
    setReturn: (target: FocusTarget) => void,
  ): Promise<boolean> => {
    if (failedWith(error, 'api_key_not_found')) {
      setReturn(headingRef);
      await refreshList();
      notify.warning(API_KEY_SETTINGS_MESSAGES.notFound);
      return true;
    }
    if (failedWith(error, 'account_unavailable')) {
      setReturn(noticeRef);
      setSuspensionFound(true);
      return true;
    }
    return false;
  };

  const showPlainKey = (key: string, returnTarget: FocusTarget): void => {
    setIssuedReturn(returnTarget);
    setPlainKey(key);
    void refreshList();
  };

  const submitForm = async (request: ApiKeyFormRequest): Promise<void> => {
    try {
      if (request.mode === 'issue') {
        const { issueApiKey } = await issueMutation.mutateAsync({
          variables: request.variables,
        });
        issueMutation.reset();
        setFormReturn(KEEP_FOCUS);
        showPlainKey(issueApiKey.plainKey, issueButtonRef);
        return;
      }
      await updateMutation.mutateAsync({ variables: request.variables });
      notify.success(API_KEY_SETTINGS_MESSAGES.saved);
      void refreshList();
    } catch (error) {
      if (!(await settleKnownFailure(error, setFormReturn))) {
        throw error;
      }
    }
  };

  const confirmAction = async ({
    action,
    apiKey,
  }: ApiKeyConfirmTarget): Promise<void> => {
    const variables = { id: apiKey.id };
    try {
      if (action === 'reissue') {
        const { reissueApiKey } = await reissueMutation.mutateAsync({
          variables,
        });
        reissueMutation.reset();
        setConfirmReturn(KEEP_FOCUS);
        showPlainKey(reissueApiKey.plainKey, confirmReturn);
        return;
      }
      await deleteMutation.mutateAsync({ variables });
      setConfirmReturn(headingRef);
      notify.success(API_KEY_SETTINGS_MESSAGES.deleted);
      void refreshList();
    } catch (error) {
      if (!(await settleKnownFailure(error, setConfirmReturn))) {
        throw error;
      }
    }
  };

  const openAction = ({ action, apiKey, trigger }: ApiKeyActionRequest) => {
    if (action === 'edit') {
      setFormReturn(focusTargetOf(trigger));
      setFormTarget({ mode: 'edit', apiKey });
      return;
    }
    setConfirmReturn(focusTargetOf(trigger));
    setConfirmTarget({ action, apiKey });
  };

  const apiKeys = query.data;
  // 取り直しの失敗では表示中のキーを消さず、取得し直している間は前の失敗を示さず読み込み中にする
  const loadFailed =
    apiKeys === undefined && !query.isFetching && query.isError;

  return (
    <div className="flex flex-col gap-6">
      {/* 再試行で消える再試行のボタンと、削除や取り直しで消えた項目から、フォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {API_KEY_SETTINGS_PAGE_TITLE}
      </h1>
      {suspended ? <SuspendedNotice noticeRef={noticeRef} /> : null}
      <p className="text-sm text-muted-foreground">
        {API_KEY_SETTINGS_MESSAGES.description}
        <PathLink href={API_DOCS_HREF} className={INLINE_LINK_CLASS_NAME}>
          {API_KEY_SETTINGS_MESSAGES.apiDocsLink}
        </PathLink>
      </p>
      <div>
        <Button
          ref={issueButtonRef}
          type="button"
          disabled={suspended}
          onClick={() => {
            setFormReturn(issueButtonRef);
            setFormTarget({ mode: 'issue' });
          }}
        >
          {API_KEY_SETTINGS_MESSAGES.issue}
        </Button>
      </div>
      <ApiKeyList
        apiKeys={apiKeys}
        loadFailed={loadFailed}
        onRetry={() => {
          void query.refetch();
        }}
        retryFocusRef={headingRef}
        hasNextPage={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        loadMoreError={query.isFetchNextPageError ? query.error : null}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
        disabledActions={suspended ? SUSPENDED_DISABLED_ACTIONS : undefined}
        onAction={openAction}
      />
      <ApiKeyFormDialog
        target={formTarget}
        onClose={() => {
          setFormTarget(null);
        }}
        returnFocusRef={formReturn}
        onSubmit={submitForm}
      />
      <ApiKeyConfirmDialog
        target={confirmTarget}
        onClose={() => {
          setConfirmTarget(null);
        }}
        returnFocusRef={confirmReturn}
        onConfirm={confirmAction}
      />
      <IssuedApiKeyDialog
        plainKey={plainKey}
        onClose={() => {
          setPlainKey(null);
        }}
        returnFocusRef={issuedReturn}
      />
    </div>
  );
}
