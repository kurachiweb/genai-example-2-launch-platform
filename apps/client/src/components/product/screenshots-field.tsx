import { useEffect, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import {
  fallbackFormatOf,
  IMAGE_MEDIA_TYPES,
  isImageMediaType,
} from '../../../common-lib/media/media-types.ts';
import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import {
  PRODUCT_SCREENSHOT_MAX_BYTES,
  PRODUCT_SCREENSHOT_PURPOSE,
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
} from '../../../common-lib/product/product-input-rules.ts';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { ImageUploadField } from '../../../lib/components/media/image-upload-field.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ImageEditOptions } from '../../../lib/utilities/media/crop-geometry.ts';
import type {
  MediaImageFallbackFormat,
  MediaImageView,
} from '../../../lib/utilities/media/picture-sources.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type {
  ProductBasicFieldValues,
  ProductScreenshotEntry,
} from './product-basic-field-values.ts';
import {
  SCREENSHOT_REMOVE_LABEL,
  SCREENSHOT_SUBJECT_LABEL,
  SCREENSHOTS_FIELD_LABEL,
  SCREENSHOTS_SELECT_LABEL,
  screenshotAltOf,
  screenshotRemoveLabelOf,
  screenshotTotalsOf,
} from './product-form-messages.ts';

const FIELD_NAME = 'fields.screenshotFileIds';

const SCREENSHOT_EDIT: ImageEditOptions = Object.freeze({
  aspect: 'free',
  maxLongSide: 1920,
});

const FALLBACK_FORMATS = Object.freeze({
  jpg: 'JPG',
  png: 'PNG',
  svg: 'SVG',
} as const satisfies Record<
  ReturnType<typeof fallbackFormatOf>,
  MediaImageFallbackFormat
>);

type ScreenshotDetails = Omit<ProductScreenshotEntry, 'fileId'>;

// 取り除いた後のフォーカスの移り先。選択のボタンか、残った画像の「取り除く」
type FocusTarget =
  | { readonly kind: 'select' }
  | { readonly kind: 'remove'; readonly fileId: string };

const imageOf = (file: UploadedFile): MediaImageView | null =>
  isImageMediaType(file.contentType)
    ? {
        objectKey: file.objectKey,
        fallbackFormat: FALLBACK_FORMATS[fallbackFormatOf(file.contentType)],
        width: file.width,
        height: file.height,
      }
    : null;

const detailsMapOf = (
  entries: readonly ProductScreenshotEntry[],
): ReadonlyMap<string, ScreenshotDetails> =>
  new Map(
    entries.map(({ fileId, image, byteSize }) => [fileId, { image, byteSize }]),
  );

export interface ScreenshotsFieldProps {
  // 編集で読み込んだスクリーンショット(表示順)。登録では空
  readonly initial: readonly ProductScreenshotEntry[];
  readonly disabled: boolean;
}

export function ScreenshotsField({ initial, disabled }: ScreenshotsFieldProps) {
  const { control, getValues } = useFormContext<ProductBasicFieldValues>();
  const currentIds = useWatch({ control, name: FIELD_NAME });
  const [details, setDetails] = useState(() => detailsMapOf(initial));
  const selectButtonRef = useRef<HTMLButtonElement | null>(null);
  const removeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  // 押した「取り除く」は描き直しで消えるため、描き直した後に移り先へフォーカスを移す
  const focusAfterRemovalRef = useRef<FocusTarget>(undefined);

  useEffect(() => {
    const target = focusAfterRemovalRef.current;
    if (target === undefined) {
      return;
    }
    focusAfterRemovalRef.current = undefined;
    if (target.kind === 'select') {
      selectButtonRef.current?.focus();
      return;
    }
    removeButtonsRef.current.get(target.fileId)?.focus();
  });

  const recordUploaded = (files: readonly UploadedFile[]): void => {
    setDetails(
      (previous) =>
        new Map([
          ...previous,
          ...files.map(
            (file) =>
              [
                file.fileId,
                { image: imageOf(file), byteSize: file.byteSize },
              ] as const,
          ),
        ]),
    );
  };

  return (
    <FormField
      control={control}
      name={FIELD_NAME}
      label={SCREENSHOTS_FIELD_LABEL}
      description={screenshotTotalsOf(
        currentIds.length,
        totalBytesOf(currentIds, details),
      )}
      disabled={disabled}
    >
      {(field) => {
        const fileIds = field.value;
        const totalBytes = totalBytesOf(fileIds, details);
        const fieldDisabled = field.disabled === true;

        const remove = (index: number) => {
          const remaining = fileIds.filter((_, position) => position !== index);
          const next = remaining[Math.min(index, remaining.length - 1)];
          field.onChange(remaining);
          focusAfterRemovalRef.current =
            next === undefined
              ? { kind: 'select' }
              : { kind: 'remove', fileId: next };
        };

        return (
          <div className="flex flex-col gap-4">
            {/* 入力欄の一覧は直前の選択の送信の記録で、取り除いた画像も残る。作り直すと送信中のアップロードが中断されるため、送る値と下の一覧だけを正とする */}
            <ImageUploadField
              ref={(element) => {
                selectButtonRef.current = element;
                field.ref(element);
              }}
              label={SCREENSHOTS_SELECT_LABEL}
              multiple
              constraints={{
                purpose: PRODUCT_SCREENSHOT_PURPOSE,
                allowedTypes: IMAGE_MEDIA_TYPES,
                maxBytes: PRODUCT_SCREENSHOT_MAX_BYTES,
                subjectLabel: SCREENSHOT_SUBJECT_LABEL,
                maxCount: PRODUCT_SCREENSHOTS_MAX,
                maxTotalBytes: PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
                existingCount: fileIds.length,
                existingTotalBytes: totalBytes,
              }}
              edit={SCREENSHOT_EDIT}
              contactAvailable={CLIENT_PROFILE.contactAvailable}
              disabled={fieldDisabled}
              onUploaded={(files) => {
                recordUploaded(files);
                // 送信は選択の後に続くため、送信中に取り除いた画像を戻さないよう、描いた時点ではなく送信を終えた時点の値に加える
                field.onChange([
                  ...getValues(FIELD_NAME),
                  ...files.map(({ fileId }) => fileId),
                ]);
              }}
              aria-labelledby={field.labelId}
              aria-describedby={field['aria-describedby']}
              aria-invalid={field['aria-invalid']}
            />
            {fileIds.length === 0 ? null : (
              <ol
                data-slot="screenshot-list"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                {fileIds.map((fileId, index) => {
                  const position = index + 1;
                  const alt = screenshotAltOf(position);
                  return (
                    <li key={fileId} className="flex min-w-0 flex-col gap-2">
                      <MediaPicture
                        image={details.get(fileId)?.image ?? null}
                        display={{ kind: 'screenshot', variant: 'thumb' }}
                        alt={alt}
                        placeholder={{ label: alt, seed: fileId }}
                        loading="lazy"
                        className="h-auto w-full rounded-md border border-border"
                      />
                      <Button
                        ref={(element) => {
                          if (element === null) {
                            removeButtonsRef.current.delete(fileId);
                          } else {
                            removeButtonsRef.current.set(fileId, element);
                          }
                        }}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        disabled={fieldDisabled}
                        aria-label={screenshotRemoveLabelOf(position)}
                        onClick={() => {
                          remove(index);
                        }}
                      >
                        {SCREENSHOT_REMOVE_LABEL}
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      }}
    </FormField>
  );
}

// 容量の分からない画像(読み込んだ値に無いID)は0として数え、保存の時点の判定に任せる
function totalBytesOf(
  fileIds: readonly string[],
  details: ReadonlyMap<string, ScreenshotDetails>,
): number {
  return fileIds.reduce(
    (sum, fileId) => sum + (details.get(fileId)?.byteSize ?? 0),
    0,
  );
}
