import { useMutation } from '@tanstack/react-query';
import { CheckIcon, LoaderCircleIcon, UserPlusIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ClientFollowUserDocument,
  ClientUnfollowUserDocument,
} from '../../graphql/generated/graphql.ts';
import { PROFILE_BOT_ACTIONS } from './bot-actions.ts';
import type { FollowButtonSize, FollowState } from './follow-button-types.ts';
import {
  FOLLOW_EMAIL_UNVERIFIED_REASON,
  FOLLOW_LABEL,
  FOLLOWING_LABEL,
  followedMessageOf,
  unfollowedMessageOf,
} from './profile-messages.ts';

export interface FollowToggleButtonProps {
  readonly handle: string;
  readonly initialFollowing: boolean;
  readonly onChange?: ((state: FollowState) => void) | undefined;
  readonly size: FollowButtonSize;
  readonly canStartFollowing: boolean;
  readonly className?: string | undefined;
}

function useFollowToggle({
  handle,
  initialFollowing,
  onChange,
  canStartFollowing,
}: Pick<
  FollowToggleButtonProps,
  'handle' | 'initialFollowing' | 'onChange' | 'canStartFollowing'
>) {
  const turnstile = useTurnstileToken();
  const follow = useMutation(graphqlMutationOptions(ClientFollowUserDocument));
  const unfollow = useMutation(
    graphqlMutationOptions(ClientUnfollowUserDocument),
  );
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [seenInitial, setSeenInitial] = useState(initialFollowing);
  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  // 取得し直した初期値が変わった時は、以前の操作の結果を捨てて新しい初期値に従う
  if (seenInitial !== initialFollowing) {
    setSeenInitial(initialFollowing);
    setConfirmed(null);
  }
  const following = pendingTarget ?? confirmed ?? initialFollowing;

  const send = (next: boolean): Promise<FollowState> =>
    sendWithTurnstile(turnstile, async (turnstileToken) => {
      const variables = { handle };
      if (next) {
        return (await follow.mutateAsync({ variables, turnstileToken }))
          .followUser;
      }
      return (await unfollow.mutateAsync({ variables, turnstileToken }))
        .unfollowUser;
    });

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する。失敗した時は確定済みの状態に戻る
  const toggle = async (): Promise<void> => {
    if (pendingTarget !== null || (!canStartFollowing && !following)) {
      return;
    }
    const next = !following;
    setPendingTarget(next);
    let state: FollowState;
    try {
      state = await send(next);
    } catch (error) {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      return;
    } finally {
      setPendingTarget(null);
    }
    setConfirmed(state.following);
    notify.success(
      state.following ? followedMessageOf(handle) : unfollowedMessageOf(handle),
    );
    // 親の処理の例外は、操作の失敗として扱わず呼び出し元の例外として伝える
    onChange?.({
      following: state.following,
      followerCount: state.followerCount,
    });
  };

  return {
    turnstile,
    following,
    pending: pendingTarget !== null,
    toggle,
  };
}

function FollowIcon({
  pending,
  following,
}: {
  readonly pending: boolean;
  readonly following: boolean;
}) {
  if (pending) {
    return <LoaderCircleIcon aria-hidden="true" className="animate-spin" />;
  }
  return following ? (
    <CheckIcon aria-hidden="true" />
  ) : (
    <UserPlusIcon aria-hidden="true" />
  );
}

// 利用者がフォローを始められない間は、押せない理由を説明として結び付ける。ボタンを`disabled`にすると、解除の直後にフォーカスが`<body>`へ落ちるため`aria-disabled`にする。フォローを始められない利用者には、状態によらず同じ枠で包み、解除でボタンを入れ替えない。`aria-disabled`のボタンはポインターを受けないため、外枠をツールチップの起点にする
export function FollowToggleButton({
  handle,
  initialFollowing,
  onChange,
  size,
  canStartFollowing,
  className,
}: FollowToggleButtonProps) {
  const { turnstile, following, pending, toggle } = useFollowToggle({
    handle,
    initialFollowing,
    onChange,
    canStartFollowing,
  });
  const reasonId = useId();
  const blocked = !canStartFollowing && !following && !pending;

  const button = (
    <Button
      type="button"
      size={size}
      variant={following ? 'secondary' : 'outline'}
      aria-pressed={following}
      aria-disabled={pending || blocked || undefined}
      aria-busy={pending || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      className={canStartFollowing ? className : 'w-full'}
      onClick={() => {
        void toggle();
      }}
    >
      <FollowIcon pending={pending} following={following} />
      {following ? FOLLOWING_LABEL : FOLLOW_LABEL}
    </Button>
  );

  return (
    <>
      {canStartFollowing ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-slot="follow-button-unverified"
              className={cn('inline-flex rounded-md', className)}
            >
              {button}
              {blocked ? (
                <span id={reasonId} className="sr-only">
                  {FOLLOW_EMAIL_UNVERIFIED_REASON}
                </span>
              ) : null}
            </span>
          </TooltipTrigger>
          {blocked ? (
            <TooltipContent>{FOLLOW_EMAIL_UNVERIFIED_REASON}</TooltipContent>
          ) : null}
        </Tooltip>
      )}
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={PROFILE_BOT_ACTIONS.follow}
      />
    </>
  );
}
