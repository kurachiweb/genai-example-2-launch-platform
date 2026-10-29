import {
  type FieldErrors,
  type FieldPath,
  type FieldRefs,
  type FieldValues,
  get,
} from 'react-hook-form';

import { SERVER_FIELD_ERROR_TYPE } from '../../utilities/forms/server-field-errors.ts';
import { mountStateOf } from './field-mount.ts';

export interface RevalidationState<T extends FieldValues> {
  readonly errors: FieldErrors<T>;
  readonly fields: FieldRefs;
  readonly values: T;
}

interface FieldErrorEntry<TPath extends string = string> {
  readonly path: TPath;
  readonly type: unknown;
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

// 描かれている欄のサーバーのエラーは利用者がその欄を直すまで残す。描かれていない欄(rulesの無い一覧の経路を含む)のサーバーのエラーは利用者が直せないため新しいスキーマの結果にする
const keepsServerFieldError = (
  fields: FieldRefs,
  { path, type }: FieldErrorEntry,
): boolean =>
  type === SERVER_FIELD_ERROR_TYPE && mountStateOf(fields, path) === true;

const listPathOf = (path: string, values: FieldValues): string | undefined => {
  const suffix = `.${LIST_ROOT_KEY}`;
  if (!path.endsWith(suffix)) {
    return undefined;
  }
  const listPath = path.slice(0, -suffix.length);
  return Array.isArray(get(values, listPath)) ? listPath : undefined;
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
  values: FieldValues,
): string[] => {
  const placeholders = paths.flatMap((path) => {
    const listPath = listPathOf(path, values);
    if (
      listPath === undefined ||
      paths.some((other) => isItemPathOf(listPath, other))
    ) {
      return [];
    }
    const items: unknown = get(values, listPath);
    return [`${listPath}.${String(Array.isArray(items) ? items.length : 0)}`];
  });
  return [...paths, ...placeholders];
};

const isFieldPathOf = <T extends FieldValues>(
  path: string,
): path is FieldPath<T> => path.length > 0;

export const revalidationTargetsOf = <T extends FieldValues>({
  errors,
  fields,
  values,
}: RevalidationState<T>): FieldPath<T>[] => {
  const paths = fieldErrorEntriesOf(errors)
    .filter((entry) => !keepsServerFieldError(fields, entry))
    .map(({ path }) => path);
  return withListItemPlaceholders(paths, values).filter(isFieldPathOf<T>);
};
