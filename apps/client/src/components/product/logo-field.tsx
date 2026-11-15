import { useFormContext } from 'react-hook-form';

import { IMAGE_MEDIA_TYPES } from '../../../common-lib/media/media-types.ts';
import {
  PRODUCT_LOGO_MAX_BYTES,
  PRODUCT_LOGO_PURPOSE,
} from '../../../common-lib/product/product-input-rules.ts';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { ImageUploadField } from '../../../lib/components/media/image-upload-field.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import type { ImageEditOptions } from '../../../lib/utilities/media/crop-geometry.ts';
import type { MediaImageView } from '../../../lib/utilities/media/picture-sources.ts';
import type { UploadConstraints } from '../../../lib/utilities/media/upload-constraints.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { productLogoAlt } from './my-product-messages.ts';
import type { ProductBasicFieldValues } from './product-basic-field-values.ts';
import {
  LOGO_FIELD_LABEL,
  LOGO_REPLACE_LABEL,
  LOGO_SELECT_LABEL,
  LOGO_SUBJECT_LABEL,
} from './product-form-messages.ts';

// APIサーバーのアップロードの用途と同じ形式
const PRODUCT_LOGO_UPLOAD: UploadConstraints = Object.freeze({
  purpose: PRODUCT_LOGO_PURPOSE,
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: PRODUCT_LOGO_MAX_BYTES,
  subjectLabel: LOGO_SUBJECT_LABEL,
});

const PRODUCT_LOGO_EDIT: ImageEditOptions = Object.freeze({
  aspect: 1,
  maxLongSide: 512,
});

const PREVIEW_SIZE = 64;

export interface LogoFieldCurrent {
  readonly fileId: string;
  // nullは画像の記録が無い
  readonly image: MediaImageView | null;
  readonly productName: string;
  readonly productHandle: string;
}

export interface LogoFieldProps {
  // 編集で読み込んだロゴ。登録では渡さない
  readonly current?: LogoFieldCurrent;
  readonly disabled: boolean;
}

export function LogoField({ current, disabled }: LogoFieldProps) {
  const { control } = useFormContext<ProductBasicFieldValues>();

  return (
    <FormField
      control={control}
      name="fields.logoFileId"
      label={LOGO_FIELD_LABEL}
      disabled={disabled}
    >
      {(field) => (
        <div className="flex flex-wrap items-start gap-4">
          {/* 新しくアップロードした画像は入力欄の一覧が縮小画像で示すため、読み込んだロゴを選んでいる間だけ示す */}
          {current !== undefined && field.value === current.fileId ? (
            <MediaPicture
              image={current.image}
              display={{ kind: 'square', size: PREVIEW_SIZE }}
              alt={productLogoAlt(current.productName)}
              placeholder={{
                label: current.productName,
                seed: current.productHandle,
              }}
              className="size-16 rounded-lg"
            />
          ) : null}
          <ImageUploadField
            ref={field.ref}
            label={
              field.value === null ? LOGO_SELECT_LABEL : LOGO_REPLACE_LABEL
            }
            constraints={PRODUCT_LOGO_UPLOAD}
            edit={PRODUCT_LOGO_EDIT}
            contactAvailable={CLIENT_PROFILE.contactAvailable}
            disabled={field.disabled === true}
            onUploaded={([uploaded]) => {
              if (uploaded !== undefined) {
                field.onChange(uploaded.fileId);
              }
            }}
            aria-labelledby={field.labelId}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            className="min-w-0 flex-1"
          />
        </div>
      )}
    </FormField>
  );
}
