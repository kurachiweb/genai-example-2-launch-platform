import { useRef } from 'react';
import { useFormContext } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import type { ProductCategoryView } from '../../graphql/my-products.ts';
import type { ProductBasicFieldValues } from './product-basic-field-values.ts';
import {
  CATEGORY_FIELD_LABEL,
  CATEGORY_PLACEHOLDER,
} from './product-form-messages.ts';

export interface CategorySelectProps {
  // 照会の順(追加の順で、標準カテゴリが末尾)のまま並べる
  readonly categories: readonly ProductCategoryView[];
  // 無効の間の値は送る値から外れるため、送る側が読み込んだカテゴリを足す
  readonly disabled: boolean;
  // 無効の理由。無効の間だけ欄に結び付けて示す
  readonly disabledReason?: string;
}

export function CategorySelect({
  categories,
  disabled,
  disabledReason,
}: CategorySelectProps) {
  const { control } = useFormContext<ProductBasicFieldValues>();
  // 一覧を開くとフォーカスが一覧へ移り開いた元の要素からフォーカスが外れるため、開いている間のフォーカスアウトは検証しない
  const openRef = useRef(false);

  return (
    <FormField
      control={control}
      name="fields.categoryId"
      label={CATEGORY_FIELD_LABEL}
      description={disabled ? disabledReason : undefined}
      disabled={disabled}
    >
      {({
        value,
        onChange,
        onBlur,
        ref,
        name,
        disabled: fieldDisabled,
        ...aria
      }) => (
        <Select
          name={name}
          value={value}
          onValueChange={onChange}
          onOpenChange={(open) => {
            openRef.current = open;
          }}
          disabled={fieldDisabled}
        >
          <SelectTrigger
            ref={ref}
            {...aria}
            aria-required
            className="w-full sm:w-72"
            onBlur={() => {
              if (!openRef.current) {
                onBlur();
              }
            }}
          >
            <SelectValue placeholder={CATEGORY_PLACEHOLDER} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
