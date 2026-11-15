import type { SquareDisplaySize } from '../../../common-lib/media/image-variants.ts';
import { cn } from '../../utilities/class-names.ts';
import type { MediaImageView } from '../../utilities/media/picture-sources.ts';
import { MediaPicture } from '../media/media-picture.tsx';

export interface AdminAvatarProps {
  // nullは未登録
  readonly image: MediaImageView | null;
  readonly nickname: string;
  readonly size: SquareDisplaySize;
  // ニックネームを隣に書かずに置く時だけ名前を渡す。既定は飾りの画像
  readonly alt?: string;
  readonly className?: string;
}

export function AdminAvatar({
  image,
  nickname,
  size,
  alt = '',
  className,
}: AdminAvatarProps) {
  return (
    <MediaPicture
      image={image}
      display={{ kind: 'square', size }}
      alt={alt}
      placeholder={{ label: nickname, seed: nickname }}
      className={cn('rounded-full', className)}
    />
  );
}
