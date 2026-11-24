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

export type FormFieldLabelPlacement = 'top' | 'end';

// 入力欄の右へラベルを並べる時も、Tabと読み上げの順序を見た目に合わせるため、入力欄をラベルより文書の前に置く
const LAYOUT_CLASS_NAMES: Readonly<
  Record<
    FormFieldLabelPlacement,
    {
      readonly field: string;
      readonly label?: string;
      readonly description?: string;
      readonly message?: string;
    }
  >
> = {
  top: { field: 'flex flex-col gap-2' },
  end: {
    field: 'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2',
    label: 'leading-normal',
    description: 'col-start-2',
    message: 'col-span-2',
  },
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
  readonly labelPlacement?: FormFieldLabelPlacement;
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
  labelPlacement = 'top',
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
  const layout = LAYOUT_CLASS_NAMES[labelPlacement];
  const labelElement = (
    <Label id={labelId} htmlFor={controlId} className={layout.label}>
      {label}
    </Label>
  );

  return (
    <div data-slot="form-field" className={cn(layout.field, className)}>
      {labelPlacement === 'top' ? labelElement : null}
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
      {labelPlacement === 'end' ? labelElement : null}
      {description === undefined ? null : (
        <p
          id={descriptionId}
          className={cn('text-sm text-muted-foreground', layout.description)}
        >
          {description}
        </p>
      )}
      {hasError ? (
        <FormMessage id={messageId} className={layout.message}>
          {message}
        </FormMessage>
      ) : null}
    </div>
  );
}
