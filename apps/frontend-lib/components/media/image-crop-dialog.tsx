import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  type LucideIcon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import Cropper, { type Area, type Point, type Size } from 'react-easy-crop';

import type {
  CropArea,
  ImageEditOptions,
} from '../../utilities/media/crop-geometry.ts';
import {
  IMAGE_CROP_AREA_KEYBOARD_HINT,
  IMAGE_CROP_AREA_LABEL,
  IMAGE_CROP_CANCEL_LABEL,
  IMAGE_CROP_CONFIRM_LABEL,
  IMAGE_CROP_CONFIRMING_LABEL,
  IMAGE_CROP_DIALOG_TITLE,
  IMAGE_CROP_ENCODE_FAILED_MESSAGE,
  IMAGE_CROP_LOADING_MESSAGE,
  IMAGE_CROP_MOVE_DOWN_LABEL,
  IMAGE_CROP_MOVE_GROUP_LABEL,
  IMAGE_CROP_MOVE_LEFT_LABEL,
  IMAGE_CROP_MOVE_RIGHT_LABEL,
  IMAGE_CROP_MOVE_UP_LABEL,
  IMAGE_CROP_UNREADABLE_MESSAGE,
  IMAGE_CROP_ZOOM_IN_LABEL,
  IMAGE_CROP_ZOOM_LABEL,
  IMAGE_CROP_ZOOM_OUT_LABEL,
  imageCropDescription,
  imageCropZoomValueText,
} from '../../utilities/messages/media-crop-messages.ts';
import { FormMessage } from '../form/form-message.tsx';
import { Button } from '../ui/button/button.tsx';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { DialogClose } from '../ui/dialog/dialog-close.tsx';
import { DialogContent } from '../ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../ui/dialog/dialog-title.tsx';
import { Label } from '../ui/label/label.tsx';
import {
  encodeCroppedImage,
  type ImageSize,
  readOrientedImageSize,
} from './encode-cropped-image.ts';

export interface ImageCropDialogProps {
  // 編集する画像。指定している間だけダイアログを開く
  readonly file: File | undefined;
  readonly edit: ImageEditOptions;
  readonly onConfirm: (file: File) => void;
  readonly onCancel: () => void;
  // 閉じた後のフォーカスの戻り先(選択のボタン)。省略すると開いた時にフォーカスのあった要素へ戻す
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_SLIDER_STEP = 0.1;
const ZOOM_BUTTON_STEP = 0.5;
const KEYBOARD_MOVE_STEP = 10;
const BUTTON_MOVE_STEP = 20;

const INITIAL_CROP: Point = { x: 0, y: 0 };

type SourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string; readonly size: ImageSize }
  | { readonly status: 'failed' };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const zoomWithin = (zoom: number): number =>
  Math.round(clamp(zoom, MIN_ZOOM, MAX_ZOOM) * 100) / 100;

// 切り取る範囲の外が見えないよう、ドラッグと同じ範囲(拡大した画像の端が範囲の端に届くまで)に位置を収める
const restrictedCrop = (
  crop: Point,
  media: Size,
  cropSize: Size,
  zoom: number,
): Point => {
  const limitX = Math.abs((media.width * zoom) / 2 - cropSize.width / 2);
  const limitY = Math.abs((media.height * zoom) / 2 - cropSize.height / 2);
  return {
    x: clamp(crop.x, -limitX, limitX),
    y: clamp(crop.y, -limitY, limitY),
  };
};

// 開く時の拡大の動きの途中に寸法を測ると、縮んだ寸法で切り取る範囲を決めてしまうため、動きが終わってから編集の領域を置く
const openAnimationsSettled = async (element: Element): Promise<void> => {
  const content = element.closest('[data-slot="dialog-content"]');
  if (content === null) {
    return;
  }
  await Promise.allSettled(
    content.getAnimations().map((animation) => animation.finished),
  );
};

interface MoveControl {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly delta: Point;
}

const MOVE_CONTROLS: readonly MoveControl[] = [
  {
    label: IMAGE_CROP_MOVE_UP_LABEL,
    icon: ArrowUpIcon,
    delta: { x: 0, y: -BUTTON_MOVE_STEP },
  },
  {
    label: IMAGE_CROP_MOVE_DOWN_LABEL,
    icon: ArrowDownIcon,
    delta: { x: 0, y: BUTTON_MOVE_STEP },
  },
  {
    label: IMAGE_CROP_MOVE_LEFT_LABEL,
    icon: ArrowLeftIcon,
    delta: { x: -BUTTON_MOVE_STEP, y: 0 },
  },
  {
    label: IMAGE_CROP_MOVE_RIGHT_LABEL,
    icon: ArrowRightIcon,
    delta: { x: BUTTON_MOVE_STEP, y: 0 },
  },
];

interface CropEditorProps {
  readonly file: File;
  readonly edit: ImageEditOptions;
  readonly onConfirm: (source: File, encoded: File) => void;
}

function CropEditor({ file, edit, onConfirm }: CropEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const zoomId = `${id}-zoom`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<SourceState>({ status: 'loading' });
  const [crop, setCrop] = useState<Point>(INITIAL_CROP);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [area, setArea] = useState<CropArea>();
  const [mediaSize, setMediaSize] = useState<Size>();
  const [cropSize, setCropSize] = useState<Size>();
  const [confirming, setConfirming] = useState(false);
  const [encodeFailed, setEncodeFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const url = URL.createObjectURL(file);
    let active = true;
    Promise.all([readOrientedImageSize(file), openAnimationsSettled(root)])
      .then(([size]) => {
        if (active) {
          setSource({ status: 'ready', url, size });
        }
      })
      .catch(() => {
        if (active) {
          setSource({ status: 'failed' });
        }
      });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const ready = source.status === 'ready';
  const aspect =
    edit.aspect !== 'free'
      ? edit.aspect
      : ready
        ? source.size.width / source.size.height
        : 1;

  const moveBy = (delta: Point) => {
    if (mediaSize === undefined || cropSize === undefined) {
      return;
    }
    setCrop((current) =>
      restrictedCrop(
        { x: current.x + delta.x, y: current.y + delta.y },
        mediaSize,
        cropSize,
        zoom,
      ),
    );
  };

  const handleConfirm = async () => {
    if (area === undefined || confirming) {
      return;
    }
    setConfirming(true);
    setEncodeFailed(false);
    try {
      onConfirm(file, await encodeCroppedImage(file, area, edit.maxLongSide));
    } catch {
      setEncodeFailed(true);
    } finally {
      setConfirming(false);
    }
  };

  const controlsDisabled = !ready || area === undefined;

  return (
    <div ref={rootRef} className="grid min-w-0 gap-4">
      <div
        className="relative h-64 w-full overflow-hidden rounded-md bg-muted sm:h-80"
        aria-busy={source.status === 'loading'}
      >
        {source.status === 'loading' ? (
          <p role="status" className="sr-only">
            {IMAGE_CROP_LOADING_MESSAGE}
          </p>
        ) : null}
        {ready ? (
          <Cropper
            image={source.url}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={aspect}
            cropShape={edit.cropShape ?? 'rect'}
            showGrid={edit.cropShape !== 'round'}
            keyboardStep={KEYBOARD_MOVE_STEP}
            onCropChange={setCrop}
            onZoomChange={(next) => {
              setZoom(zoomWithin(next));
            }}
            onCropAreaChange={(_percentages: Area, pixels: Area) => {
              setArea(pixels);
            }}
            setMediaSize={setMediaSize}
            setCropSize={setCropSize}
            mediaProps={{
              onError: () => {
                setSource({ status: 'failed' });
              },
            }}
            cropperProps={{
              role: 'group',
              'aria-label': IMAGE_CROP_AREA_LABEL,
              'aria-describedby': hintId,
            }}
            classes={{
              // 範囲が枠の端に接すると外側の輪郭が枠の外へ切れるため、輪郭を範囲の内側に描く
              cropAreaClassName: 'focus-visible:-outline-offset-4',
            }}
          />
        ) : null}
      </div>
      <p id={hintId} className="sr-only">
        {IMAGE_CROP_AREA_KEYBOARD_HINT}
      </p>
      {source.status === 'failed' ? (
        <FormMessage role="alert">{IMAGE_CROP_UNREADABLE_MESSAGE}</FormMessage>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 grow items-center gap-2">
          <Label htmlFor={zoomId} className="shrink-0">
            {IMAGE_CROP_ZOOM_LABEL}
          </Label>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={controlsDisabled}
            onClick={() => {
              setZoom((current) => zoomWithin(current - ZOOM_BUTTON_STEP));
            }}
          >
            <MinusIcon aria-hidden="true" />
            <span className="sr-only">{IMAGE_CROP_ZOOM_OUT_LABEL}</span>
          </Button>
          <input
            id={zoomId}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_SLIDER_STEP}
            value={zoom}
            aria-valuetext={imageCropZoomValueText(zoom)}
            disabled={controlsDisabled}
            className="h-9 min-w-24 grow accent-primary disabled:opacity-50"
            onChange={(event) => {
              setZoom(zoomWithin(Number(event.currentTarget.value)));
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={controlsDisabled}
            onClick={() => {
              setZoom((current) => zoomWithin(current + ZOOM_BUTTON_STEP));
            }}
          >
            <PlusIcon aria-hidden="true" />
            <span className="sr-only">{IMAGE_CROP_ZOOM_IN_LABEL}</span>
          </Button>
        </div>
        <div
          role="group"
          aria-label={IMAGE_CROP_MOVE_GROUP_LABEL}
          className="flex items-center gap-2"
        >
          {MOVE_CONTROLS.map(({ label, icon: Icon, delta }) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              size="icon"
              disabled={controlsDisabled}
              onClick={() => {
                moveBy(delta);
              }}
            >
              <Icon aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </Button>
          ))}
        </div>
      </div>
      {encodeFailed ? (
        <FormMessage role="alert">
          {IMAGE_CROP_ENCODE_FAILED_MESSAGE}
        </FormMessage>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {IMAGE_CROP_CANCEL_LABEL}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={controlsDisabled}
          aria-disabled={confirming ? true : undefined}
          aria-busy={confirming ? true : undefined}
          onClick={() => {
            void handleConfirm();
          }}
        >
          {confirming ? IMAGE_CROP_CONFIRMING_LABEL : IMAGE_CROP_CONFIRM_LABEL}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ImageCropDialog({
  file,
  edit,
  onConfirm,
  onCancel,
  returnFocusRef,
}: ImageCropDialogProps) {
  // 閉じる動きの間も中身を描き続けるため最後に開いた画像を持ち、画像が替わる度に編集の状態を始め直す
  const [shown, setShown] = useState({ file, generation: 0 });
  if (file !== undefined && file !== shown.file) {
    setShown({ file, generation: shown.generation + 1 });
  }
  const shownFile = shown.file;
  const currentFileRef = useRef(file);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    currentFileRef.current = file;
  }, [file]);

  return (
    <Dialog
      open={file !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      {shownFile === undefined ? null : (
        <DialogContent
          className="sm:max-w-xl"
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef?.current ?? openerRef.current;
            if (target instanceof HTMLElement && target.isConnected) {
              target.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{IMAGE_CROP_DIALOG_TITLE}</DialogTitle>
            <DialogDescription className="break-all">
              {imageCropDescription(shownFile.name)}
            </DialogDescription>
          </DialogHeader>
          <CropEditor
            key={shown.generation}
            file={shownFile}
            edit={edit}
            onConfirm={(source, encoded) => {
              // 作り直しの間に取り消された、または別の画像へ切り替わった結果は渡さない
              if (currentFileRef.current === source) {
                onConfirm(encoded);
              }
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
