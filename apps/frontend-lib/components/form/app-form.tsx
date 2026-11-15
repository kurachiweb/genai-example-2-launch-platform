import {
  type ComponentProps,
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type FieldPath,
  type FieldPathValue,
  type FieldValues,
  FormProvider,
  type UseFormReturn,
} from 'react-hook-form';

import { mountStateOf } from './field-mount.ts';
import { createSubmitHolds, SubmitHoldsContext } from './submit-hold.ts';
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
> extends Omit<
  ComponentProps<'form'>,
  'onSubmit' | 'noValidate' | 'method' | 'ref'
> {
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

// 利用者やブラウザの自動入力が文字を入れ得る種類の入力欄。チェックボックス・ラジオ・ファイル・隠し欄などは水和の前に値が変わらないため対象にしない
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'password',
  'search',
  'tel',
  'url',
]);

interface EnteredValue {
  readonly name: string;
  readonly value: string;
}

const enteredValuesOf = (form: HTMLFormElement): readonly EnteredValue[] =>
  Array.from(form.elements).flatMap((element) =>
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      TEXT_ENTRY_INPUT_TYPES.has(element.type))
      ? [{ name: element.name, value: element.value }]
      : [],
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
  const formRef = useRef<HTMLFormElement>(null);
  const [submitHolds] = useState(createSubmitHolds);

  // 遅い回線や自動入力で水和の前に入力欄へ入った値は、DOMに残ってもフォームの状態に入らず送信ボタンが無効のまま残るため、水和の直後に取り込んで検証し直す
  useEffect(() => {
    const element = formRef.current;
    if (element === null) {
      return;
    }
    for (const { name, value } of enteredValuesOf(element)) {
      if (mountStateOf(form.control._fields, name) !== true) {
        continue;
      }
      const path = name as FieldPath<TFieldValues>;
      const current: unknown = form.getValues(path);
      if (typeof current === 'string' && current !== value) {
        form.setValue(
          path,
          value as FieldPathValue<TFieldValues, typeof path>,
          { shouldValidate: true, shouldDirty: true },
        );
      }
    }
  }, [form]);

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
          // rulesの無い一覧は_fを持たないため、一覧の名前の集合で描かれているとみなす
          isFieldMounted: (path) =>
            mountStateOf(form.control._fields, path) ??
            form.control._names.array.has(path),
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
    // アップロード中の欄などの値はまだ前の値のため、そのまま送ると古い値で保存して成功を示してしまう。送らずに、その欄に待つ理由を示させる
    const held = submitHolds.first();
    if (held !== undefined) {
      held.onSubmitHeld();
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
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        {...props}
        method="post"
      >
        <SubmitHoldsContext value={submitHolds}>{children}</SubmitHoldsContext>
      </form>
    </FormProvider>
  );
}
