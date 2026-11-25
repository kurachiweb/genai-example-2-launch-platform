import { useCallback, useState } from 'react';

import { cn } from '../../../../lib/utilities/class-names.ts';
import { MediaPicture } from '../../../../lib/components/media/media-picture.tsx';
import { MediaPlaceholder } from '../../../../lib/components/media/media-placeholder.tsx';
import {
  type PictureDisplay,
  pictureSizeOf,
} from '../../../../lib/utilities/media/picture-sources.ts';
import type { PlaceholderInput } from '../../../../lib/utilities/media/placeholder-appearance.ts';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';

export interface AdminMediaImageProps {
  // nullは削除済み・未設定
  readonly file: AdminMediaFileView | null;
  readonly display: PictureDisplay;
  readonly alt: string;
  // 名前と、配色を決めるID
  readonly placeholder: PlaceholderInput;
  readonly className?: string;
}

// 公開中の画像は画像配信ドメインの変換配信から表示する。隔離中の画像は変換配信から配信されないため、管理者側のサイトと同じオリジンの中継の経路から原本を表示し、寸法の分からない原本は表示の枠に収める
export function AdminMediaImage({
  file,
  display,
  alt,
  placeholder,
  className,
}: AdminMediaImageProps) {
  const servable =
    file !== null && !file.quarantined && file.image.objectKey !== null;
  const path = file === null || servable ? null : file.path;
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const markFailed = useCallback(() => {
    setFailedPath(path);
  }, [path]);
  // サーバー側の描画の画像がハイドレーションの前に読み込みに失敗すると、errorの事象を受け取れないため、結び付けた時点の状態を確かめる
  const detectEarlyFailure = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete === true && element.naturalWidth === 0) {
        markFailed();
      }
    },
    [markFailed],
  );

  if (servable) {
    return (
      <MediaPicture
        image={file.image}
        display={display}
        alt={alt}
        placeholder={placeholder}
        loading="lazy"
        className={className}
      />
    );
  }

  const size = pictureSizeOf(display, null);
  if (path === null || failedPath === path) {
    return (
      <MediaPlaceholder
        kind={display.kind}
        placeholder={placeholder}
        alt={alt}
        size={size}
        className={className}
      />
    );
  }

  return (
    <img
      ref={detectEarlyFailure}
      src={path}
      width={size.width}
      height={size.height}
      alt={alt}
      loading="lazy"
      className={cn('object-contain', className)}
      onError={markFailed}
    />
  );
}
