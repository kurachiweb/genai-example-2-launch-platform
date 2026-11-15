import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';

const isContainer = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const shallowCopy = (value: object): object =>
  Array.isArray(value) ? value.slice() : { ...value };

// 経路の上にあるオブジェクトと配列だけを複製してキーを除き、元の値と他の値の参照は変えない
const withoutPath = (value: unknown, segments: readonly string[]): unknown => {
  const [head, ...rest] = segments;
  if (
    head === undefined ||
    !isContainer(value) ||
    !Object.hasOwn(value, head)
  ) {
    return value;
  }
  const copy = shallowCopy(value);
  if (rest.length === 0) {
    Reflect.deleteProperty(copy, head);
  } else {
    Reflect.set(copy, head, withoutPath(Reflect.get(value, head), rest));
  }
  return copy;
};

// エラーを除いて空になったオブジェクトと配列は、エラーが残っているとみなされないよう親からも除く
const withoutErrorPath = (
  errors: unknown,
  segments: readonly string[],
): unknown => {
  const [head, ...rest] = segments;
  if (
    head === undefined ||
    !isContainer(errors) ||
    !Object.hasOwn(errors, head)
  ) {
    return errors;
  }
  const copy = shallowCopy(errors);
  const child =
    rest.length === 0
      ? undefined
      : withoutErrorPath(Reflect.get(errors, head), rest);
  if (child === undefined) {
    Reflect.deleteProperty(copy, head);
  } else {
    Reflect.set(copy, head, child);
  }
  return Object.keys(copy).length === 0 ? undefined : copy;
};

const pathsOf = (names: ReadonlySet<string>): readonly string[][] =>
  [...names].map((name) => name.split('.'));

// react-hook-formはresolverへ全欄の値を渡し、欄の再検証でもisValidを返したエラーの全体で決めるため、無効の欄の判定はresolverの引数ではなく制御の無効の欄の集合で行う
export const withoutDisabledFieldErrors =
  <TFieldValues extends FieldValues, TContext, TTransformedValues>(
    resolver: Resolver<TFieldValues, TContext, TTransformedValues>,
    disabledNames: () => ReadonlySet<string>,
  ): Resolver<TFieldValues, TContext, TTransformedValues> =>
  async (values, context, options) => {
    const disabledPaths = pathsOf(disabledNames());
    if (disabledPaths.length === 0) {
      return resolver(values, context, options);
    }
    // resolverが受け取る値はフォームの値そのもののため、変更せず複製から無効の欄を除く
    const enabledValues = disabledPaths.reduce<unknown>(
      withoutPath,
      values,
    ) as TFieldValues;
    const result = await resolver(enabledValues, context, options);
    if (Object.keys(result.errors).length === 0) {
      return result;
    }
    const errors = (disabledPaths.reduce<unknown>(
      withoutErrorPath,
      result.errors,
    ) ?? {}) as FieldErrors<TFieldValues>;
    if (Object.keys(errors).length > 0) {
      return { values: {}, errors };
    }
    // 無効になり得る欄を任意にしないスキーマでは出力の値が無いため、変換を受けない入力の値で送信を進める
    return {
      values: enabledValues as unknown as TTransformedValues,
      errors: {},
    };
  };
