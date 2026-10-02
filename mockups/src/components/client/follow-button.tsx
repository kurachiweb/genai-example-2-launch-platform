import { useState } from 'react';
import { CheckIcon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';
import type { User } from '#/lib/mock-data';
import { UNVERIFIED_MESSAGE } from '#/lib/messages';
import { cn } from '#/lib/utils';

type Props = {
  target: Pick<User, 'handle'>;
  // 本人には表示しないため、呼び出し側で本人以外の場合のみ描画する
  viewer: 'guest' | 'user' | 'unverified';
  onRequireLogin: () => void;
  onFollowingChange?: (following: boolean) => void;
  size?: 'sm' | 'default';
  className?: string;
};

export function FollowButton({
  target,
  viewer,
  onRequireLogin,
  onFollowingChange,
  size = 'sm',
  className,
}: Props) {
  const [following, setFollowing] = useState(false);

  if (viewer === 'unverified') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn('inline-flex rounded-md', className)}
          >
            <Button size={size} variant="outline" disabled className="w-full">
              <UserPlusIcon aria-hidden="true" />
              フォロー
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{UNVERIFIED_MESSAGE}</TooltipContent>
      </Tooltip>
    );
  }

  const toggle = () => {
    if (viewer === 'guest') {
      onRequireLogin();
      return;
    }
    const next = !following;
    setFollowing(next);
    onFollowingChange?.(next);
    toast.success(
      next
        ? `@${target.handle}をフォローしました。`
        : `@${target.handle}のフォローを解除しました。`,
    );
  };

  return (
    <Button
      size={size}
      variant={following ? 'secondary' : 'outline'}
      aria-pressed={following}
      onClick={toggle}
      className={className}
    >
      {following ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <UserPlusIcon aria-hidden="true" />
      )}
      {following ? 'フォロー中' : 'フォロー'}
    </Button>
  );
}
