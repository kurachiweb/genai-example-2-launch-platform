import type { SquareDisplaySize } from '../../../common-lib/media/image-variants.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { MediaImageView } from '../../../lib/utilities/media/picture-sources.ts';
import { avatarLabelOf } from './profile-messages.ts';

export interface UserAvatarProps {
  readonly user: {
    readonly handle: string;
    readonly nickname: string;
    // nullは未設定
    readonly avatar: MediaImageView | null;
  };
  readonly size: SquareDisplaySize;
  readonly className?: string;
}

export function UserAvatar({ user, size, className }: UserAvatarProps) {
  return (
    <MediaPicture
      image={user.avatar}
      display={{ kind: 'square', size }}
      alt={avatarLabelOf(user.nickname)}
      placeholder={{ label: user.nickname, seed: user.handle }}
      className={cn('rounded-full object-cover', className)}
    />
  );
}
