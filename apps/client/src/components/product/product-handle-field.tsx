import { useQueryClient } from '@tanstack/react-query';
import { useFormContext } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { SERVER_FIELD_ERROR_TYPE } from '../../../lib/utilities/forms/server-field-errors.ts';
import { fetchProductHandleAvailability } from '../../graphql/my-products.ts';
import type { ProductBasicFieldValues } from './product-basic-field-values.ts';
import {
  PRODUCT_FORM_MESSAGES,
  PRODUCT_HANDLE_FIELD_LABEL,
  PRODUCT_HANDLE_PREFIX,
  previousProductHandleGuidanceOf,
} from './product-form-messages.ts';

const FIELD_NAME = 'fields.handle';

export interface ProductHandleFieldProps {
  // 編集で読み込んだ時点のハンドル。サーバーが使用可として扱う値のため問い合わせず、他の値は編集中のプロダクトとして問い合わせる。登録では渡さない
  readonly currentHandle?: string;
  readonly previousHandle: string | null;
  readonly disabled: boolean;
}

export function ProductHandleField({
  currentHandle,
  previousHandle,
  disabled,
}: ProductHandleFieldProps) {
  const queryClient = useQueryClient();
  const form = useFormContext<ProductBasicFieldValues>();

  // 形式が正しい時だけ問い合わせ、応答を待つ間に値が変わっていれば古い応答を捨てる。肯定の表示は作らない
  const checkAvailability = async (handle: string): Promise<void> => {
    if (handle === currentHandle || !(await form.trigger(FIELD_NAME))) {
      return;
    }
    const availability = await fetchProductHandleAvailability(
      queryClient,
      handle,
      currentHandle,
    );
    if (
      availability !== 'UNAVAILABLE' ||
      form.getValues(FIELD_NAME) !== handle
    ) {
      return;
    }
    form.setError(FIELD_NAME, {
      type: SERVER_FIELD_ERROR_TYPE,
      message: PRODUCT_FORM_MESSAGES.handleUnavailable,
    });
  };

  return (
    <FormField
      control={form.control}
      name={FIELD_NAME}
      label={PRODUCT_HANDLE_FIELD_LABEL}
      description={
        previousHandle === null
          ? undefined
          : previousProductHandleGuidanceOf(previousHandle)
      }
      disabled={disabled}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <span
            data-slot="handle-prefix"
            aria-hidden="true"
            className="text-muted-foreground"
          >
            {PRODUCT_HANDLE_PREFIX}
          </span>
          <Input
            {...control}
            onBlur={() => {
              control.onBlur();
              void checkAvailability(control.value);
            }}
            aria-required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      )}
    </FormField>
  );
}
