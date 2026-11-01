import { useCallback, useState } from 'react';

import {
  buildPictureSources,
  type MediaImageView,
  type PictureDisplay,
  pictureSizeOf,
} from '../../utilities/media/picture-sources.ts';
import type { PlaceholderInput } from '../../utilities/media/placeholder-appearance.ts';
import { MediaPlaceholder } from './media-placeholder.tsx';
import { useImagesOrigin } from './use-images-origin.ts';

export interface MediaPictureProps {
  readonly image: MediaImageView | null;
  readonly display: PictureDisplay;
  readonly alt: string;
  // 名前と、配色を決めるID
  readonly placeholder: PlaceholderInput;
  readonly loading?: 'eager' | 'lazy';
  readonly className?: string;
}

export function MediaPicture({
  image,
  display,
  alt,
  placeholder,
  loading,
  className,
}: MediaPictureProps) {
  const origin = useImagesOrigin();
  const objectKey = image?.objectKey ?? null;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const markFailed = useCallback(() => {
    setFailedKey(objectKey);
  }, [objectKey]);
  // サーバー側の描画の画像がハイドレーションの前に読み込みに失敗すると、errorの事象を受け取れないため、結び付けた時点の状態を確かめる。decode()は読み込めた画像でも拒否するブラウザがあるため、読み込みを終えて寸法が0であることで失敗と判定する
  const detectEarlyFailure = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete === true && element.naturalWidth === 0) {
        markFailed();
      }
    },
    [markFailed],
  );

  if (image === null || image.objectKey === null || failedKey === objectKey) {
    return (
      <MediaPlaceholder
        kind={display.kind}
        placeholder={placeholder}
        alt={alt}
        size={pictureSizeOf(display, image)}
        className={className}
      />
    );
  }

  const { sources, img } = buildPictureSources({
    origin,
    image: { ...image, objectKey: image.objectKey },
    display,
  });
  const imageElement = (
    <img
      ref={detectEarlyFailure}
      src={img.src}
      srcSet={img.srcSet}
      width={img.width}
      height={img.height}
      alt={alt}
      loading={loading}
      className={className}
      onError={markFailed}
    />
  );
  if (sources.length === 0) {
    return imageElement;
  }
  return (
    <picture data-slot="media-picture">
      {sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} />
      ))}
      {imageElement}
    </picture>
  );
}
