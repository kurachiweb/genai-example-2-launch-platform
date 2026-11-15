import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import {
  ULTRAS_AVATAR_LABEL,
  ULTRAS_AVATAR_TOOLTIP,
} from './profile-messages.ts';
import { UserAvatar, type UserAvatarProps } from './user-avatar.tsx';

export interface ProfileAvatarProps {
  readonly user: UserAvatarProps['user'];
  readonly ultras: boolean;
}

const AVATAR_SIZE_CLASS_NAME = 'size-20 sm:size-24';

const ULTRAS_RING_CLASS_NAME =
  'inline-flex shrink-0 cursor-default rounded-full ring-3 ring-primary ring-offset-3 ring-offset-card focus-visible:ring-ring';

// 表示は128pxの変数をCSSで96px(640px未満は80px)に縮める。色だけに頼らないよう、輪には読み上げ用の文言とツールチップを添える
export function ProfileAvatar({ user, ultras }: ProfileAvatarProps) {
  const avatar = (
    <UserAvatar user={user} size={128} className={AVATAR_SIZE_CLASS_NAME} />
  );
  if (!ultras) {
    return avatar;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="profile-avatar-ultras"
          className={ULTRAS_RING_CLASS_NAME}
        >
          {avatar}
          <span className="sr-only">
            <span translate="no">Ultras</span>
            {ULTRAS_AVATAR_LABEL}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span translate="no">Ultras</span>
        {ULTRAS_AVATAR_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}
