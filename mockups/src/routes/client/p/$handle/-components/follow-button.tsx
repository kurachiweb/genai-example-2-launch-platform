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

import { UNVERIFIED_MESSAGE, usePageContext } from './page-context';

type Props = { maker: User };

export function FollowButton({ maker }: Props) {
  const { role, requireLogin } = usePageContext();
  const [following, setFollowing] = useState(false);

  if (role === 'owner') return null;

  if (role === 'unverified') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md">
            <Button size="sm" variant="outline" disabled>
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
    if (role === 'guest') {
      requireLogin('follow');
      return;
    }
    setFollowing((current) => !current);
    toast.success(
      following
        ? `@${maker.handle}のフォローを解除しました。`
        : `@${maker.handle}をフォローしました。`,
    );
  };

  return (
    <Button
      size="sm"
      variant={following ? 'secondary' : 'outline'}
      aria-pressed={following}
      onClick={toggle}
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
