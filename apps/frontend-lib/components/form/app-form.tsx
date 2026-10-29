import { type ComponentProps, type SubmitEvent, useRef } from 'react';
import {
  type FieldValues,
  FormProvider,
  type UseFormReturn,
} from 'react-hook-form';

import { applyServerFieldErrors } from '../../utilities/forms/server-field-errors.ts';
import {
  type FieldErrorDetail,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';

export interface SubmitErrorContext {
  readonly unmatched: readonly FieldErrorDetail[];
}

export interface AppFormProps<
  TFieldValues extends FieldValues,
  TTransformedValues,
> extends Omit<ComponentProps<'form'>, 'onSubmit' | 'noValidate'> {
  readonly form: UseFormReturn<TFieldValues, unknown, TTransformedValues>;
  readonly onSubmit: (values: TTransformedValues) => Promise<void> | void;
  readonly onSubmitError: (error: unknown, context: SubmitErrorContext) => void;
  readonly serverFieldPrefix?: string;
}

const withoutPrefix = (
  details: readonly FieldErrorDetail[],
  prefix: string | undefined,
): readonly FieldErrorDetail[] =>
  prefix === undefined
    ? details
    : details.map((detail) =>
        detail.field.startsWith(`${prefix}.`)
          ? { ...detail, field: detail.field.slice(prefix.length + 1) }
          : detail,
      );

export function AppForm<TFieldValues extends FieldValues, TTransformedValues>({
  form,
  onSubmit,
  onSubmitError,
  serverFieldPrefix,
  children,
  ...props
}: AppFormProps<TFieldValues, TTransformedValues>) {
  const submittingRef = useRef(false);

  // 送信はイベントから切り離したPromiseで進むため、失敗の処理の例外は未処理の拒否にせず、ブラウザの未捕捉の例外と同じ経路(エラートラッキングの全体の受け口)へ渡す
  const notifySubmitError = (
    error: unknown,
    context: SubmitErrorContext,
  ): void => {
    try {
      onSubmitError(error, context);
    } catch (handlerError) {
      globalThis.reportError(handlerError);
    }
  };

  const submitValues = async (values: TTransformedValues): Promise<void> => {
    try {
      await onSubmit(values);
    } catch (error) {
      const details =
        error instanceof GraphQLClientError ? (error.details ?? []) : [];
      const { unmatched } = applyServerFieldErrors(
        {
          getValues: form.getValues,
          setError: form.setError,
          isFieldDisabled: (path) => form.control._names.disabled.has(path),
        },
        withoutPrefix(details, serverFieldPrefix),
      );
      if (details.length === 0 || unmatched.length > 0) {
        notifySubmitError(error, { unmatched });
      }
    }
  };

  // 送信中の表示とボタンの無効化は再描画の後に効くため、同じ描画の間に重なった送信(Enterの連打やrequestSubmitの重複)はここで止める
  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    try {
      await form.handleSubmit(submitValues)(event);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}
