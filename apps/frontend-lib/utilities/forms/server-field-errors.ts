import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

import type { FieldErrorDetail } from '../graphql/graphql-result.ts';

export type ServerFieldErrorTarget<T extends FieldValues> = Pick<
  UseFormReturn<T>,
  'getValues' | 'setError'
> & {
  readonly isFieldDisabled: (path: string) => boolean;
  readonly isFieldMounted: (path: string) => boolean;
};

// スキーマを切り替えた時の再検証で、描かれている欄のサーバーのエラーを検証のエラー(種類はZodの問題のコード)と見分けて残すため、詳細のコードによらず固定の種類にする
export const SERVER_FIELD_ERROR_TYPE = 'server';

export interface ServerFieldErrorsResult {
  readonly unmatched: readonly FieldErrorDetail[];
}

// react-hook-formが入れ子の値として複製する値(cloneObject)にそろえ、Date・File・FileListなどは欄の値として扱う
const isGroupedValue = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  value.constructor === Object;

const isFieldPathOf = <T extends FieldValues>(
  values: T,
  path: string,
): path is FieldPath<T> => {
  let current: unknown = values;
  for (const segment of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      !Object.hasOwn(current, segment)
    ) {
      return false;
    }
    current = Reflect.get(current, segment);
  }
  return !isGroupedValue(current);
};

const isWithinDisabledField = <T extends FieldValues>(
  form: ServerFieldErrorTarget<T>,
  path: string,
): boolean => {
  const segments = path.split('.');
  return segments.some((_, index) =>
    form.isFieldDisabled(segments.slice(0, index + 1).join('.')),
  );
};

// 欄をまとめた親・無効の欄・描かれていない欄に付けたエラーは、利用者が入力し直して消せず送信ボタンが無効のまま残るため、欄に対応しない詳細として返す
export const applyServerFieldErrors = <T extends FieldValues>(
  form: ServerFieldErrorTarget<T>,
  details: readonly FieldErrorDetail[],
): ServerFieldErrorsResult => {
  const values = form.getValues();
  const applied = new Set<string>();
  const unmatched: FieldErrorDetail[] = [];
  for (const detail of details) {
    const { field } = detail;
    if (
      isWithinDisabledField(form, field) ||
      !isFieldPathOf(values, field) ||
      !form.isFieldMounted(field)
    ) {
      unmatched.push(detail);
      continue;
    }
    if (applied.has(field)) {
      continue;
    }
    form.setError(
      field,
      { type: SERVER_FIELD_ERROR_TYPE, message: detail.message },
      { shouldFocus: applied.size === 0 },
    );
    applied.add(field);
  }
  return { unmatched };
};
