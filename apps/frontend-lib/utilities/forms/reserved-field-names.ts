export const RESERVED_FIELD_NAMES = [
  'type',
  'message',
  'types',
  'ref',
] as const;

const isReservedName = (key: string): boolean =>
  RESERVED_FIELD_NAMES.some((name) => name === key);

// react-hook-formが入れ子の値として複製する値(cloneObject。配列と、プロトタイプがnullかコンストラクタがObjectの値)にそろえ、Date・Fileなどは欄の値として扱う
const isNestedValue = (value: unknown): value is object => {
  if (Array.isArray(value)) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || value.constructor === Object;
};

const pathsWithin = (value: object, prefix: string): string[] =>
  Object.entries(value).flatMap(([key, child]: [string, unknown]) => {
    const path = `${prefix}${key}`;
    const own = prefix !== '' && isReservedName(key) ? [path] : [];
    return isNestedValue(child)
      ? [...own, ...pathsWithin(child, `${path}.`)]
      : own;
  });

// 欄のエラーの末端はこれらの名前を持つオブジェクトで判定するため、欄をまとめた値の子の欄にこの名前があると、その値の経路ごと欄のエラーの末端と見分けられなくなる。最上位のキーは末端の判定に影響しないため含めない
export const reservedFieldNamePathsOf = (defaultValues: unknown): string[] =>
  isNestedValue(defaultValues) ? pathsWithin(defaultValues, '') : [];
