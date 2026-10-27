import { type ReactNode, useId } from 'react';
import {
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  useController,
} from 'react-hook-form';

import { cn } from '../../utilities/class-names.ts';
import { Label } from '../ui/label/label.tsx';
import { FormMessage } from './form-message.tsx';

export type FormControlProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = ControllerRenderProps<TFieldValues, TName> & {
  readonly id: string;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-describedby': string | undefined;
};

export interface FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues,
> {
  readonly control: Control<TFieldValues, unknown, TTransformedValues>;
  readonly name: TName;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly children: (
    control: FormControlProps<TFieldValues, TName>,
  ) => ReactNode;
}

export function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues,
>({
  control,
  name,
  label,
  description,
  className,
  children,
}: FormFieldProps<TFieldValues, TName, TTransformedValues>) {
  const { field, fieldState } = useController({ control, name });
  const id = useId();
  const controlId = `${id}-control`;
  const descriptionId = `${id}-description`;
  const messageId = `${id}-message`;
  const message = fieldState.error?.message;
  const hasError = message !== undefined && message !== '';
  const describedBy = [
    description === undefined ? undefined : descriptionId,
    hasError ? messageId : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' ');

  return (
    <div
      data-slot="form-field"
      className={cn('flex flex-col gap-2', className)}
    >
      <Label htmlFor={controlId}>{label}</Label>
      {children({
        ...field,
        id: controlId,
        'aria-invalid': hasError ? true : undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
      {description === undefined ? null : (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {hasError ? <FormMessage id={messageId}>{message}</FormMessage> : null}
    </div>
  );
}
