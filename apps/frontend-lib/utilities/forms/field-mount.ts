import { type FieldRefs, get } from 'react-hook-form';

// react-hook-formはshouldUnregisterが偽の時、描かれなくなった欄の名前を_names.mountに残し、_fieldsの_f.mountだけを偽にするため、_f.mountで判定する。_fを持たない経路(rulesの無い一覧・欄をまとめた親・登録されていない値)はundefinedを返す
export const mountStateOf = (
  fields: FieldRefs,
  path: string,
): boolean | undefined => {
  const field: unknown = get(fields, path);
  if (typeof field !== 'object' || field === null || !('_f' in field)) {
    return undefined;
  }
  const { _f: registration } = field;
  return (
    typeof registration === 'object' &&
    registration !== null &&
    'mount' in registration &&
    registration.mount === true
  );
};
