import { describe, expect, test } from 'bun:test';
import { createFormControl } from 'react-hook-form';

import type { FieldErrorDetail } from '../graphql/graphql-result.ts';
import { applyServerFieldErrors } from './server-field-errors.ts';

interface ProductForm {
  title: string;
  tagline: string;
  maker: { name: string };
  links: string[];
}

const DEFAULT_VALUES: ProductForm = {
  title: '',
  tagline: '',
  maker: { name: '' },
  links: ['https://product.example'],
};

const REGISTERED_FIELDS = [
  'title',
  'tagline',
  'maker.name',
  'links.0',
] as const;

const createForm = () => {
  const form = createFormControl<ProductForm>({
    defaultValues: DEFAULT_VALUES,
  });
  const focused: string[] = [];
  for (const name of REGISTERED_FIELDS) {
    form.register(name).ref({
      name,
      value: '',
      focus: () => {
        focused.push(name);
      },
    });
  }
  return { form, focused };
};

const detail = (
  field: string,
  message: string,
  code = 'invalid',
): FieldErrorDetail => ({ field, message, code });

describe('applyServerFieldErrors', () => {
  test('項目ごとの詳細を対応する欄のエラーにし、対応しない詳細を返す', () => {
    const { form } = createForm();
    const unknownField = detail('price', '価格を入力してください。');
    const wholeInput = detail('', '入力内容を確認してください。');

    const { unmatched } = applyServerFieldErrors(form, [
      detail('title', '製品名を入力してください。', 'too_small'),
      unknownField,
      detail('maker.name', '作成者名は50文字以内で入力してください。'),
      wholeInput,
    ]);

    expect(form.getFieldState('title').error).toMatchObject({
      type: 'too_small',
      message: '製品名を入力してください。',
    });
    expect(form.getFieldState('maker.name').error).toMatchObject({
      type: 'invalid',
      message: '作成者名は50文字以内で入力してください。',
    });
    expect(form.getFieldState('tagline').error).toBeUndefined();
    expect(unmatched).toEqual([unknownField, wholeInput]);
  });

  test('配列の要素の欄にも対応付ける', () => {
    const { form } = createForm();
    const outOfRange = detail('links.3', 'URLの形式で入力してください。');

    const { unmatched } = applyServerFieldErrors(form, [
      detail('links.0', 'URLの形式で入力してください。'),
      outOfRange,
    ]);

    expect(form.getFieldState('links.0').error?.message).toBe(
      'URLの形式で入力してください。',
    );
    expect(unmatched).toEqual([outOfRange]);
  });

  test('値の中を指す経路でも、文字列の値の中や継承したプロパティは欄として扱わない', () => {
    const { form } = createForm();
    const details = [
      detail('title.length', '不正です。'),
      detail('maker.toString', '不正です。'),
      detail('constructor', '不正です。'),
    ];

    const { unmatched } = applyServerFieldErrors(form, details);

    expect(unmatched).toEqual(details);
  });

  test('対応する欄のうち最初の欄へだけフォーカスを移す', () => {
    const { form, focused } = createForm();

    applyServerFieldErrors(form, [
      detail('price', '価格を入力してください。'),
      detail('maker.name', '作成者名を入力してください。'),
      detail('title', '製品名を入力してください。'),
    ]);

    expect(focused).toEqual(['maker.name']);
  });

  test('同じ欄に複数の詳細があれば最初の詳細を表示する', () => {
    const { form } = createForm();

    const { unmatched } = applyServerFieldErrors(form, [
      detail('title', '製品名を入力してください。', 'too_small'),
      detail('title', '製品名に使えない文字が含まれています。', 'invalid'),
    ]);

    expect(form.getFieldState('title').error).toMatchObject({
      type: 'too_small',
      message: '製品名を入力してください。',
    });
    expect(unmatched).toEqual([]);
  });

  test('詳細が無ければ何もしない', () => {
    const { form, focused } = createForm();

    const { unmatched } = applyServerFieldErrors(form, []);

    expect(unmatched).toEqual([]);
    expect(focused).toEqual([]);
    expect(form.getFieldState('title').error).toBeUndefined();
  });
});
