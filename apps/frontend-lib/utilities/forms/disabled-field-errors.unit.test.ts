import { describe, expect, mock, test } from 'bun:test';
import { zodResolver } from '@hookform/resolvers/zod';
import type {
  FieldErrors,
  FieldValues,
  Resolver,
  ResolverOptions,
} from 'react-hook-form';

import { z } from '../validation/zod.ts';
import { withoutDisabledFieldErrors } from './disabled-field-errors.ts';

const resolverOptions = <T extends FieldValues>(): ResolverOptions<T> => ({
  fields: {},
  shouldUseNativeValidation: false,
});

const fieldError = (message: string) => ({ type: 'invalid', message });

const recordingResolver = (
  errors: Readonly<Record<string, unknown>> = {},
): {
  readonly resolver: Resolver;
  readonly received: () => unknown;
} => {
  let receivedValues: unknown;
  const resolver = mock<Resolver>((values) => {
    receivedValues = values;
    return Object.keys(errors).length === 0
      ? { values, errors: {} }
      : { values: {}, errors: errors as FieldErrors };
  });
  return { resolver, received: () => receivedValues };
};

const sparseAt = (index: number, value: unknown): unknown[] => {
  const array: unknown[] = [];
  array[index] = value;
  return array;
};

const valueAt = (value: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        typeof current === 'object' && current !== null
          ? Reflect.get(current, key)
          : undefined,
      value,
    );

const disabled =
  (...names: readonly string[]) =>
  (): ReadonlySet<string> =>
    new Set(names);

describe('withoutDisabledFieldErrors', () => {
  test('無効の欄の値を除いた複製を元の検証へ渡し、受け取った値を変更しない', async () => {
    const launchedAt = new Date('2026-10-28T00:00:00Z');
    const untouched = { name: 'Pitch Notes' };
    const values = {
      fields: { title: 'Pitch Notes', categoryId: '', tags: ['a', 'b'] },
      items: [{ label: '1件目', code: 'x' }],
      maker: untouched,
      launchedAt,
    };
    const snapshot = structuredClone(values);
    const { resolver, received } = recordingResolver();

    await withoutDisabledFieldErrors(
      resolver,
      disabled('fields.categoryId', 'fields.tags.1', 'items.0.code'),
    )(values, undefined, resolverOptions());

    const passed = received();
    expect(passed).not.toBe(values);
    expect(Object.keys(valueAt(passed, 'fields') ?? {})).toStrictEqual([
      'title',
      'tags',
    ]);
    expect(valueAt(passed, 'fields.title')).toBe('Pitch Notes');
    expect(valueAt(passed, 'fields.tags')).toHaveLength(2);
    expect(Object.keys(valueAt(passed, 'fields.tags') ?? {})).toStrictEqual([
      '0',
    ]);
    expect(valueAt(passed, 'items')).toStrictEqual([{ label: '1件目' }]);
    expect(valueAt(passed, 'maker')).toBe(untouched);
    expect(valueAt(passed, 'launchedAt')).toBe(launchedAt);
    expect(values).toStrictEqual(snapshot);
  });

  test('無効の欄が無ければ、受け取った値をそのまま元の検証へ渡す', async () => {
    const values = { title: 'Pitch Notes' };
    const { resolver, received } = recordingResolver();
    const context = { locale: 'ja' };

    const result = await withoutDisabledFieldErrors(resolver, disabled())(
      values,
      context,
      resolverOptions(),
    );

    expect(received()).toBe(values);
    expect(resolver).toHaveBeenCalledWith(values, context, resolverOptions());
    expect(result).toStrictEqual({ values, errors: {} });
  });

  test('任意にした無効の欄の値がスキーマを通らなくても、変換を通った値を返す', async () => {
    const schema = z.object({
      title: z.string().trim().min(1, 'プロダクト名を入力してください。'),
      categoryId: z.string().min(1, 'カテゴリを選んでください。').optional(),
    });
    const resolver = withoutDisabledFieldErrors(
      zodResolver(schema),
      disabled('categoryId'),
    );

    const result = await resolver(
      { title: '  Pitch Notes  ', categoryId: '' },
      undefined,
      resolverOptions(),
    );

    expect(result).toStrictEqual({
      values: { title: 'Pitch Notes' },
      errors: {},
    });
  });

  test('任意にしないスキーマでは無効の欄のエラーを除き、無効の欄を除いた入力の値を項目をまたぐ検証を受けずに返す', async () => {
    const schema = z
      .object({
        fields: z.object({
          title: z.string().trim().min(1, 'プロダクト名を入力してください。'),
          categoryId: z.string().min(1, 'カテゴリを選んでください。'),
        }),
        email: z.string(),
        confirmation: z.string(),
      })
      .refine((value) => value.email === value.confirmation, {
        path: ['confirmation'],
        message: '確認用のメールアドレスが一致しません。',
      });
    const resolver = withoutDisabledFieldErrors(
      zodResolver(schema),
      disabled('fields.categoryId'),
    );

    const result: unknown = await resolver(
      {
        fields: { title: '  Pitch Notes  ', categoryId: 'gadgets' },
        email: 'owner@example.example',
        confirmation: 'other@example.example',
      },
      undefined,
      resolverOptions(),
    );

    expect(result).toStrictEqual({
      values: {
        fields: { title: '  Pitch Notes  ' },
        email: 'owner@example.example',
        confirmation: 'other@example.example',
      },
      errors: {},
    });
  });

  test('無効の欄とその子の経路のエラーを除いて空になった親も除き、他の欄のエラーとrootを残す', async () => {
    const titleError = fieldError('プロダクト名を入力してください。');
    const rootError = fieldError('入力内容を確認してください。');
    const { resolver } = recordingResolver({
      fields: {
        title: titleError,
        categoryId: fieldError('カテゴリを選んでください。'),
      },
      address: { city: fieldError('市区町村を入力してください。') },
      items: sparseAt(1, { code: fieldError('コードを入力してください。') }),
      root: rootError,
    });

    const result = await withoutDisabledFieldErrors(
      resolver,
      disabled('fields.categoryId', 'address', 'items.1.code'),
    )(
      { fields: { title: '' }, address: { city: '' }, items: [] },
      undefined,
      resolverOptions(),
    );

    expect(result).toStrictEqual({
      values: {},
      errors: { fields: { title: titleError }, root: rootError },
    });
  });

  test('無効の欄のエラーだけが残れば、空のエラーと無効の欄を除いた入力の値を返す', async () => {
    const { resolver } = recordingResolver({
      address: { city: fieldError('市区町村を入力してください。') },
      items: sparseAt(1, { code: fieldError('コードを入力してください。') }),
    });

    const result = await withoutDisabledFieldErrors(
      resolver,
      disabled('address', 'items.1.code'),
    )(
      {
        title: 'Pitch Notes',
        address: { city: '' },
        items: [{ code: 'a' }, { code: '' }],
      },
      undefined,
      resolverOptions(),
    );

    expect(result).toStrictEqual({
      values: { title: 'Pitch Notes', items: [{ code: 'a' }, {}] },
      errors: {},
    });
  });
});
