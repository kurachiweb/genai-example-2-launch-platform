import type { SquareDisplaySize } from '../../../common-lib/media/image-variants.ts';
import type { MediaImageView } from '../../utilities/media/picture-sources.ts';
import { MediaPicture } from '../media/media-picture.tsx';

export type InquirerAvatarSize = 'xs' | 'sm';

export interface InquirerAvatarProps {
  // nullは未登録
  readonly image: MediaImageView | null;
  readonly nickname: string;
  readonly size: InquirerAvatarSize;
}

const DISPLAY_SIZES: Readonly<Record<InquirerAvatarSize, SquareDisplaySize>> =
  Object.freeze({ xs: 32, sm: 64 });

// ニックネームを隣に書いて置く飾りの画像のため、代替テキストを空にする
export function InquirerAvatar({ image, nickname, size }: InquirerAvatarProps) {
  return (
    <MediaPicture
      image={image}
      display={{ kind: 'square', size: DISPLAY_SIZES[size] }}
      alt=""
      placeholder={{ label: nickname, seed: nickname }}
      className="rounded-full"
    />
  );
}
