import { FileIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  isImageMediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import { cn } from '../../utilities/class-names.ts';

export interface FileThumbnailProps {
  readonly file: File;
  readonly className?: string;
}

const THUMBNAIL_CSS_SIZE = 48;

const FRAME_CLASS_NAME =
  'size-12 shrink-0 rounded-md border border-border bg-muted';

// 中央を基準に、枠を覆う大きさまで拡大・縮小して描く(object-fit: coverと同じ)
function drawCover(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }
  const { width, height } = canvas;
  const { naturalWidth, naturalHeight } = image;
  if (naturalWidth === 0 || naturalHeight === 0) {
    context.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const drawnWidth = naturalWidth * scale;
  const drawnHeight = naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawnWidth) / 2,
    (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
}

// GIF・APNG・アニメーションWebP・SVGのアニメーションを動かし続けないよう、読み込んだ時点の1コマだけをcanvasへ描き、オブジェクトURLはすぐに破棄する
function drawStillFrame(canvas: HTMLCanvasElement, file: File): () => void {
  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.round(THUMBNAIL_CSS_SIZE * pixelRatio);
  canvas.height = Math.round(THUMBNAIL_CSS_SIZE * pixelRatio);
  const url = URL.createObjectURL(file);
  const image = new Image();
  const controller = new AbortController();
  const release = () => {
    controller.abort();
    URL.revokeObjectURL(url);
  };
  image.addEventListener(
    'load',
    () => {
      drawCover(canvas, image);
      release();
    },
    { signal: controller.signal },
  );
  image.addEventListener('error', release, { signal: controller.signal });
  image.src = url;
  return release;
}

export function FileThumbnail({ file, className }: FileThumbnailProps) {
  const type = parseMediaType(file.type);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    return drawStillFrame(canvas, file);
  }, [file]);

  if (type === undefined || !isImageMediaType(type)) {
    const Icon = type === 'text/plain' ? FileTextIcon : FileIcon;
    return (
      <span
        data-slot="file-thumbnail"
        className={cn(
          FRAME_CLASS_NAME,
          'flex items-center justify-center text-muted-foreground',
          className,
        )}
      >
        <Icon aria-hidden="true" className="size-6" />
      </span>
    );
  }

  return (
    <canvas
      data-slot="file-thumbnail"
      ref={canvasRef}
      aria-hidden="true"
      className={cn(FRAME_CLASS_NAME, className)}
    />
  );
}
