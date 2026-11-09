import { useFormContext } from 'react-hook-form';

import { PRODUCT_DESCRIPTION_MAX_GRAPHEMES } from '../../../common-lib/product/product-input-rules.ts';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { MarkdownEditor } from '../../../lib/components/markdown-editor/markdown-editor.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import {
  DESCRIPTION_FIELD_LABEL,
  DESCRIPTION_PLACEHOLDER,
} from './product-form-messages.ts';
import type { ProductFormInput } from './product-form-schema.ts';

export interface ProductDescriptionFieldProps {
  readonly disabled: boolean;
}

export function ProductDescriptionField({
  disabled,
}: ProductDescriptionFieldProps) {
  const { control } = useFormContext<ProductFormInput>();
  // プロダクト詳細の説明文と同じrelの指定で描き、本文の識別子だけ入力欄の中と分ける
  const preview = useMarkdownOptions({
    externalLinkRel: ['noopener'],
    idScope: 'preview',
  });

  return (
    <FormField
      control={control}
      name="fields.description"
      label={DESCRIPTION_FIELD_LABEL}
      disabled={disabled}
    >
      {(field) => (
        <MarkdownEditor
          value={field.value}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          labelId={field.labelId}
          describedById={field['aria-describedby']}
          invalid={field['aria-invalid'] === true}
          disabled={field.disabled === true}
          maxGraphemes={PRODUCT_DESCRIPTION_MAX_GRAPHEMES}
          placeholder={DESCRIPTION_PLACEHOLDER}
          preview={preview}
        />
      )}
    </FormField>
  );
}
