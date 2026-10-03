import { UserAvatar } from '#/components/client/user-avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';
import type { User } from '#/lib/mock-data';

type Props = {
  user: User;
  broken: boolean;
  ultras: boolean;
};

const SIZE_PX = 96;
const SIZE_CLASS = 'size-20 sm:size-24';

// Ultrasの特典が有効な間はアバターをプライマリ色の輪で縁取る。色だけに頼らないよう、ツールチップと読み上げ用の文言を添える
export function ProfileAvatar({ user, broken, ultras }: Props) {
  const avatar = (
    <UserAvatar
      user={user}
      size={SIZE_PX}
      broken={broken}
      className={SIZE_CLASS}
    />
  );
  if (!ultras) return avatar;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex shrink-0 rounded-full ring-3 ring-primary ring-offset-3 ring-offset-card focus-visible:ring-ring focus-visible:outline-3 focus-visible:outline-offset-6 focus-visible:outline-ring/50"
        >
          {avatar}
          <span className="sr-only">
            <span translate="no">Ultras</span>加入中
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span translate="no">Ultras</span>
        プランでLaunch Stadiumを応援しています。
      </TooltipContent>
    </Tooltip>
  );
}
