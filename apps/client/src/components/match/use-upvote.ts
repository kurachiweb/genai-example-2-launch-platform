import { useMutation } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { createElement, type ReactElement, useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ClientCancelUpvoteDocument,
  ClientUpvoteDocument,
  type MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { LoginRequiredDialog } from '../auth/login-required-dialog.tsx';
import {
  UPVOTE_CANCELLED_MESSAGE,
  UPVOTE_LOGIN_REQUIRED_DESCRIPTION,
  UPVOTE_LOGIN_REQUIRED_TITLE,
  UPVOTED_MESSAGE,
} from './upvote-messages.ts';
import { useUpvoteTurnstile } from './upvote-turnstile.ts';

export interface UseUpvoteOptions {
  readonly match: MatchFragment;
  // 呼び出し元の取得の結果(キャッシュ)をサーバーが返したマッチで更新する
  readonly onUpdated: (match: MatchFragment) => void;
}

export interface UpvoteControls {
  // 送信中の側。送信中でなければnull
  readonly pendingEntryId: string | null;
  // 未ログインはログインの案内を開き、それ以外は押した側に応じてUpvote・付け替え・取り消しを送る
  readonly toggle: (entryId: string) => void;
  // 呼び出し元が描画する、未ログインのログインの案内
  readonly loginDialog: ReactElement;
}

function useLoginDialog(): {
  readonly open: () => void;
  readonly element: ReactElement;
} {
  const [isOpen, setIsOpen] = useState(false);
  const returnTo = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });
  return {
    open: () => {
      setIsOpen(true);
    },
    element: createElement(LoginRequiredDialog, {
      open: isOpen,
      onOpenChange: setIsOpen,
      title: UPVOTE_LOGIN_REQUIRED_TITLE,
      description: UPVOTE_LOGIN_REQUIRED_DESCRIPTION,
      returnTo,
    }),
  };
}

export function useUpvote({
  match,
  onUpdated,
}: UseUpvoteOptions): UpvoteControls {
  const turnstile = useUpvoteTurnstile();
  const loginDialog = useLoginDialog();
  const upvote = useMutation(graphqlMutationOptions(ClientUpvoteDocument));
  const cancelUpvote = useMutation(
    graphqlMutationOptions(ClientCancelUpvoteDocument),
  );
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  // 同じイベントの中の2回目の押下は描画の前に届くため、送信中かどうかを描画を待たずに読める値でも持つ
  const sendingRef = useRef(false);

  const send = (entryId: string, isCancel: boolean): Promise<MatchFragment> =>
    sendWithTurnstile(turnstile, async (turnstileToken) => {
      if (isCancel) {
        return (
          await cancelUpvote.mutateAsync({
            variables: { matchId: match.id },
            turnstileToken,
          })
        ).cancelUpvote;
      }
      return (
        await upvote.mutateAsync({
          variables: { input: { matchId: match.id, entryId } },
          turnstileToken,
        })
      ).upvote;
    });

  // 表示はサーバーの結果でだけ変えるため、失敗した時は操作の前の表示のまま理由を通知する
  const toggleAsync = async (entryId: string): Promise<void> => {
    if (sendingRef.current) {
      return;
    }
    if (match.viewerRestriction === 'GUEST') {
      loginDialog.open();
      return;
    }
    if (match.viewerRestriction !== null) {
      return;
    }
    const isCancel = match.viewerUpvotedEntryId === entryId;
    sendingRef.current = true;
    setPendingEntryId(entryId);
    let updated: MatchFragment;
    try {
      updated = await send(entryId, isCancel);
    } catch (error) {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      return;
    } finally {
      sendingRef.current = false;
      setPendingEntryId(null);
    }
    notify.success(isCancel ? UPVOTE_CANCELLED_MESSAGE : UPVOTED_MESSAGE);
    // 呼び出し元の処理の例外は、操作の失敗として扱わず呼び出し元の例外として伝える
    onUpdated(updated);
  };

  return {
    pendingEntryId,
    toggle: (entryId) => {
      void toggleAsync(entryId);
    },
    loginDialog: loginDialog.element,
  };
}
