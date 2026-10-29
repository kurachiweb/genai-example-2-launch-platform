import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import {
  createFormControl,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  useForm,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

import { withoutDisabledFieldErrors } from '../../utilities/forms/disabled-field-errors.ts';
import { mountStateOf } from './field-mount.ts';

export interface AppFormOptions<TInput extends FieldValues> {
  // サーバーの詳細は既定値に経路がある欄にだけ対応するため、部分的な既定値を受け付けず全欄を求める
  readonly defaultValues: TInput & DefaultValues<TInput>;
}

const DEFAULT_INVALID_MESSAGE = '入力内容を確認してください。';

// 検証規則に文言を書き忘れた欄でも、Zodの英語の既定の文言を利用者に見せないため、規則ごとの文言が無い時だけ文言規則に沿った文言にする
const fallbackMessage = (): string => DEFAULT_INVALID_MESSAGE;

const MODE = 'onTouched';

// 入れ子のエラーのうち、typeかmessageを持つ項目を欄のエラーとみなして経路を集める。フォーム全体のrootは欄でないため除く
const errorPathsOf = (errors: object, prefix = ''): string[] =>
  Object.entries(errors).flatMap(([key, value]: [string, unknown]) => {
    const isFormRoot = prefix === '' && key === 'root';
    if (isFormRoot || typeof value !== 'object' || value === null) {
      return [];
    }
    const path = `${prefix}${key}`;
    return 'type' in value || 'message' in value
      ? [path]
      : errorPathsOf(value, `${path}.`);
  });

export function useAppForm<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  { defaultValues }: AppFormOptions<TInput>,
): UseFormReturn<TInput, unknown, TOutput> {
  // resolverが無効の欄の集合を読めるよう、制御を先に作ってからuseFormへ渡す
  const [created] = useState(() =>
    createFormControl<TInput, unknown, TOutput>({ mode: MODE, defaultValues }),
  );
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
  const { trigger } = form;

  // スキーマを切り替えるとisValidが古いスキーマの結果のまま残るため、新しいスキーマで検証し直す。名前の配列を渡したtriggerは全欄の検証の結果でisValidを計算し直し、渡した欄のエラーだけを置き換えるため、描かれている欄の表示中のエラー(サーバーのエラーを含む)を残し、利用者が直せない描かれていない欄のエラーだけを新しい結果にする
  useEffect(() => {
    const unmountedErrorPaths = errorPathsOf(
      created.control._formState.errors,
    ).filter(
      (path): path is FieldPath<TInput> =>
        mountStateOf(created.control._fields, path) !== true,
    );
    void trigger(unmountedErrorPaths);
  }, [schema, created, trigger]);

  return form;
}
