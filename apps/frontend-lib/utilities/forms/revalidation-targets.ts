import type { FieldErrors, FieldPath, FieldValues } from 'react-hook-form';

import { SERVER_FIELD_ERROR_TYPE } from './server-field-errors.ts';

export interface RevalidationState<T extends FieldValues> {
  readonly errors: FieldErrors<T>;
  readonly values: T;
  readonly isFieldMounted: (path: string) => boolean;
}

interface FieldErrorEntry {
  readonly path: string;
  readonly type: unknown;
}

interface ListRoot {
  readonly listPath: string;
  readonly length: number;
}

const LIST_ROOT_KEY = 'root';

// react-hook-formは欄のエラーに必ずrefを付け、setError(name, {})やtypesだけのエラーも欄のエラーとして持つ。refの値は欄の要素のため、その中へは入らない
const isFieldError = (value: object): boolean =>
  'type' in value || 'message' in value || 'types' in value || 'ref' in value;

// 入れ子のエラーから欄のエラーの経路を集める。フォーム全体のrootは欄でないため除く
const fieldErrorEntriesOf = (errors: object, prefix = ''): FieldErrorEntry[] =>
  Object.entries(errors).flatMap(([key, value]: [string, unknown]) => {
    const isFormRoot = prefix === '' && key === LIST_ROOT_KEY;
    if (isFormRoot || typeof value !== 'object' || value === null) {
      return [];
    }
    const path = `${prefix}${key}`;
    if (!isFieldError(value)) {
      return fieldErrorEntriesOf(value, `${path}.`);
    }
    return [{ path, type: 'type' in value ? value.type : undefined }];
  });

const valueAt = (values: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (current, segment) =>
        typeof current === 'object' &&
        current !== null &&
        Object.hasOwn(current, segment)
          ? (Reflect.get(current, segment) as unknown)
          : undefined,
      values,
    );

// 一覧全体のエラーは、値が配列の経路の下のrootに付く
const listRootOf = (path: string, values: unknown): ListRoot | undefined => {
  const suffix = `.${LIST_ROOT_KEY}`;
  if (!path.endsWith(suffix)) {
    return undefined;
  }
  const listPath = path.slice(0, -suffix.length);
  const items = valueAt(values, listPath);
  return Array.isArray(items) ? { listPath, length: items.length } : undefined;
};

const ITEM_INDEX = /^\d+$/u;

const isItemPathOf = (listPath: string, path: string): boolean => {
  const prefix = `${listPath}.`;
  const [index = ''] = path.startsWith(prefix)
    ? path.slice(prefix.length).split('.')
    : [];
  return ITEM_INDEX.test(index);
};

// 一覧全体のエラー(<一覧>.root)は、検証する名前に一覧の中の経路がある時だけresolverが<一覧>.rootへ入れ子にして返し、無いとtriggerが新しいエラーを見つけられず消してしまう。一覧の中の欄を名前に加えるとその欄のエラーまで置き換えるため、エラーの付かない存在しない次の要素の経路を加えて入れ子にさせる
const withListItemPlaceholders = (
  paths: readonly string[],
  values: unknown,
): string[] => {
  const placeholders = paths.flatMap((path) => {
    const listRoot = listRootOf(path, values);
    if (
      listRoot === undefined ||
      paths.some((other) => isItemPathOf(listRoot.listPath, other))
    ) {
      return [];
    }
    return [`${listRoot.listPath}.${String(listRoot.length)}`];
  });
  return [...paths, ...placeholders];
};

const isFieldPathOf = <T extends FieldValues>(
  path: string,
): path is FieldPath<T> => path.length > 0;

// 描かれている欄のサーバーのエラーは利用者がその欄を直すまで残す。描かれていない欄(rulesの無い一覧の経路を含む)のサーバーのエラーは利用者が直せないため新しいスキーマの結果にする
export const revalidationTargetsOf = <T extends FieldValues>({
  errors,
  values,
  isFieldMounted,
}: RevalidationState<T>): FieldPath<T>[] => {
  const paths = fieldErrorEntriesOf(errors)
    .filter(
      ({ path, type }) =>
        type !== SERVER_FIELD_ERROR_TYPE || !isFieldMounted(path),
    )
    .map(({ path }) => path);
  return withListItemPlaceholders(paths, values).filter(isFieldPathOf<T>);
};
