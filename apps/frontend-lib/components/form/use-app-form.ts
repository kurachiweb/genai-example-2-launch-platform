import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import {
  createFormControl,
  type DefaultValues,
  type FieldValues,
  useForm,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

import { withoutDisabledFieldErrors } from '../../utilities/forms/disabled-field-errors.ts';
import {
  RESERVED_FIELD_NAMES,
  reservedFieldNamePathsOf,
} from '../../utilities/forms/reserved-field-names.ts';
import { revalidationTargetsOf } from '../../utilities/forms/revalidation-targets.ts';
import { mountStateOf } from './field-mount.ts';

export interface AppFormOptions<TInput extends FieldValues> {
  // サーバーの詳細は既定値に経路がある欄にだけ対応するため、部分的な既定値を受け付けず全欄を求める
  readonly defaultValues: TInput & DefaultValues<TInput>;
}

const DEFAULT_INVALID_MESSAGE = '入力内容を確認してください。';

// 検証規則に文言を書き忘れた欄でも、Zodの英語の既定の文言を利用者に見せないため、規則ごとの文言が無い時だけ文言規則に沿った文言にする
const fallbackMessage = (): string => DEFAULT_INVALID_MESSAGE;

const MODE = 'onTouched';

const assertNoReservedFieldNames = (defaultValues: unknown): void => {
  const paths = reservedFieldNamePathsOf(defaultValues);
  if (paths.length > 0) {
    throw new TypeError(
      `既定値の入れ子のキーに、フォームが欄のエラーと見分けられない名前(${RESERVED_FIELD_NAMES.join('・')})があります。名前を変えてください: ${paths.join('、')}`,
    );
  }
};

export function useAppForm<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  { defaultValues }: AppFormOptions<TInput>,
): UseFormReturn<TInput, unknown, TOutput> {
  // resolverが無効の欄の集合を読めるよう、制御を先に作ってからuseFormへ渡す
  const [created] = useState(() => {
    // 使い方の誤りを実装中に知らせる検査で、ビルド時にNODE_ENVが置き換わり本番のバンドルからは除かれる
    if (process.env.NODE_ENV !== 'production') {
      assertNoReservedFieldNames(defaultValues);
    }
    return createFormControl<TInput, unknown, TOutput>({
      mode: MODE,
      defaultValues,
    });
  });
  const resolver = withoutDisabledFieldErrors(
    zodResolver(schema, { error: fallbackMessage }),
    () => created.control._names.disabled,
  );
  const form = useForm<TInput, unknown, TOutput>({
    formControl: created.formControl,
    mode: MODE,
    resolver,
    defaultValues,
  });
  const { trigger, getValues, getErrors, getFieldState } = form;

  // スキーマを切り替えるとisValidと表示中のエラーが古いスキーマの結果のまま残るため、新しいスキーマで検証し直す。名前の配列を渡したtriggerは全欄の検証の結果でisValidを計算し直し、渡した欄のエラーだけを置き換えるため、描かれている欄のサーバーのエラーだけを残し、まだ触れていない欄にエラーを出さずに済む。errorsとtouchedFieldsはformStateのproxyから読むとフォームが更新を購読して描き直すため、購読しないgetErrorsとgetFieldStateで読む
  useEffect(() => {
    const {
      _fields: fields,
      _names: { array: arrayNames },
    } = created.control;
    void trigger(
      revalidationTargetsOf({
        errors: getErrors(),
        values: getValues(),
        isFieldMounted: (path) => mountStateOf(fields, path) === true,
        isFieldTouched: (path) => getFieldState(path).isTouched,
        isFieldArray: (path) => arrayNames.has(path),
      }),
    );
  }, [schema, created, trigger, getValues, getErrors, getFieldState]);

  return form;
}
