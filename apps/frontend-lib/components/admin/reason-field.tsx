import type { FieldPath, FieldValues } from 'react-hook-form';

import {
  OPTIONAL_REASON_LABEL,
  REASON_PERSONAL_INFORMATION_NOTICE,
  REQUIRED_REASON_LABEL,
} from '../../utilities/messages/admin-console-messages.ts';
import { FormField, type FormFieldProps } from '../form/form-field.tsx';
import { Textarea } from '../ui/textarea/textarea.tsx';

export interface ReasonFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues,
> extends Omit<
  FormFieldProps<TFieldValues, TName, TTransformedValues>,
  'label' | 'description' | 'children'
> {
  readonly required: boolean;
}

export function ReasonField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues,
>({
  required,
  ...fieldProps
}: ReasonFieldProps<TFieldValues, TName, TTransformedValues>) {
  return (
    <FormField
      {...fieldProps}
      label={required ? REQUIRED_REASON_LABEL : OPTIONAL_REASON_LABEL}
      description={REASON_PERSONAL_INFORMATION_NOTICE}
    >
      {(control) => (
        <Textarea
          {...control}
          aria-required={required ? true : undefined}
          className="max-h-60"
        />
      )}
    </FormField>
  );
}
