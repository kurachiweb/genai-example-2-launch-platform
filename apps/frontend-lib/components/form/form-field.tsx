import { type ReactNode, useEffect, useId } from 'react';
import {
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  useController,
  useFormContext,
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
  // 列挙しない値のため{...control}の展開では写らない。名前を付けられない要素のaria-labelledbyへはcontrol.labelIdで読んで渡す
  readonly labelId: string;
};

// 子は受け取った値を入力要素へそのまま展開できる。DOMの属性に無いlabelIdが要素へ出力されないよう、展開で写らない列挙しない値として加える
const withLabelId = <TControl extends object>(
  control: TControl,
  labelId: string,
): TControl & { readonly labelId: string } =>
  Object.defineProperty(control, 'labelId', {
    value: labelId,
    enumerable: false,
  }) as TControl & { readonly labelId: string };

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
  readonly disabled?: boolean;
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
  disabled,
  children,
}: FormFieldProps<TFieldValues, TName, TTransformedValues>) {
  const { field, fieldState } = useController({ control, name, disabled });
  const { clearErrors } = useFormContext<TFieldValues>();
  // 無効の欄は利用者が入力し直せず、付いていたエラーが欄の再検証でも消えないため、無効にした時に消す
  useEffect(() => {
    if (disabled === true) {
      clearErrors(name);
    }
  }, [disabled, name, clearErrors]);
  const id = useId();
  const controlId = `${id}-control`;
  const labelId = `${id}-label`;
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
      <Label id={labelId} htmlFor={controlId}>
        {label}
      </Label>
      {children(
        withLabelId(
          {
            ...field,
            id: controlId,
            'aria-invalid': hasError ? true : undefined,
            'aria-describedby': describedBy === '' ? undefined : describedBy,
          },
          labelId,
        ),
      )}
      {description === undefined ? null : (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {hasError ? <FormMessage id={messageId}>{message}</FormMessage> : null}
    </div>
  );
}
