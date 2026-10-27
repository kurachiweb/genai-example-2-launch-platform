import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

import type { FieldErrorDetail } from '../graphql/graphql-result.ts';

export type ServerFieldErrorTarget<T extends FieldValues> = Pick<
  UseFormReturn<T>,
  'getValues' | 'setError'
>;

export interface ServerFieldErrorsResult {
  readonly unmatched: readonly FieldErrorDetail[];
}

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
  return true;
};

export const applyServerFieldErrors = <T extends FieldValues>(
  form: ServerFieldErrorTarget<T>,
  details: readonly FieldErrorDetail[],
): ServerFieldErrorsResult => {
  const values = form.getValues();
  const applied = new Set<string>();
  const unmatched: FieldErrorDetail[] = [];
  for (const detail of details) {
    const { field } = detail;
    if (!isFieldPathOf(values, field)) {
      unmatched.push(detail);
      continue;
    }
    if (applied.has(field)) {
      continue;
    }
    form.setError(
      field,
      { type: detail.code, message: detail.message },
      { shouldFocus: applied.size === 0 },
    );
    applied.add(field);
  }
  return { unmatched };
};
