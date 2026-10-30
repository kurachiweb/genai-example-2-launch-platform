import { describe, expect, expectTypeOf, test } from 'bun:test';
import { createFormControl } from 'react-hook-form';
import type { z } from 'zod';

import type { FieldErrorDetail } from '../graphql/graphql-result.ts';
import {
  applyServerFieldErrors,
  SERVER_FIELD_ERROR_TYPE,
} from './server-field-errors.ts';

interface ProductForm {
  title: string;
  tagline: string;
  maker: { name: string };
  links: string[];
  launchedAt: Date;
  note: string | null;
}

const DEFAULT_VALUES: ProductForm = {
  title: '',
  tagline: '',
  maker: { name: '' },
  links: ['https://product.example'],
  launchedAt: new Date('2026-10-28T00:00:00Z'),
  note: null,
};

const REGISTERED_FIELDS = [
  'title',
  'tagline',
  'maker.name',
  'links',
  'links.0',
  'launchedAt',
  'note',
] as const;

interface FieldStates {
  readonly disabled?: readonly string[];
  readonly unmounted?: readonly string[];
}

const createForm = ({ disabled = [], unmounted = [] }: FieldStates = {}) => {
  const control = createFormControl<ProductForm>({
    defaultValues: DEFAULT_VALUES,
  });
  const focused: string[] = [];
  for (const name of REGISTERED_FIELDS) {
    control.register(name).ref({
      name,
      value: '',
      focus: () => {
        focused.push(name);
      },
    });
  }
  const disabledPaths = new Set(disabled);
  const unmountedPaths = new Set(unmounted);
  const form = {
    getValues: control.getValues,
    setError: control.setError,
    isFieldDisabled: (path: string) => disabledPaths.has(path),
    isFieldMounted: (path: string) => !unmountedPaths.has(path),
  };
  return { form, control, focused };
};

const detail = (
  field: string,
  message: string,
  code = 'invalid',
): FieldErrorDetail => ({ field, message, code });

describe('applyServerFieldErrors', () => {
  test('項目ごとの詳細を対応する欄のエラーにし、対応しない詳細を返す', () => {
    const { form, control } = createForm();
    const unknownField = detail('price', '価格を入力してください。');
    const wholeInput = detail('', '入力内容を確認してください。');

    const { unmatched } = applyServerFieldErrors(form, [
      detail('title', '製品名を入力してください。', 'too_small'),
      unknownField,
      detail('maker.name', '作成者名は50文字以内で入力してください。'),
      wholeInput,
    ]);

    expect(control.getFieldState('title').error).toMatchObject({
      type: SERVER_FIELD_ERROR_TYPE,
      message: '製品名を入力してください。',
    });
    expect(control.getFieldState('maker.name').error).toMatchObject({
      type: SERVER_FIELD_ERROR_TYPE,
      message: '作成者名は50文字以内で入力してください。',
    });
    expect(control.getFieldState('tagline').error).toBeUndefined();
    expect(unmatched).toEqual([unknownField, wholeInput]);
  });

  test('配列の要素の欄にも対応付ける', () => {
    const { form, control } = createForm();
    const outOfRange = detail('links.3', 'URLの形式で入力してください。');

    const { unmatched } = applyServerFieldErrors(form, [
      detail('links.0', 'URLの形式で入力してください。'),
      outOfRange,
    ]);

    expect(control.getFieldState('links.0').error?.message).toBe(
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
    const { form, control } = createForm();

    const { unmatched } = applyServerFieldErrors(form, [
      detail('title', '製品名を入力してください。', 'too_small'),
      detail('title', '製品名に使えない文字が含まれています。', 'invalid'),
    ]);

    expect(control.getFieldState('title').error).toMatchObject({
      type: SERVER_FIELD_ERROR_TYPE,
      message: '製品名を入力してください。',
    });
    expect(unmatched).toEqual([]);
  });

  test('欄のエラーの種類は詳細のコードによらず固定の種類にし、検証のエラーの種類(Zodの問題のコード)と重ならない', () => {
    const { form, control } = createForm();

    applyServerFieldErrors(form, [
      detail('title', 'このプロダクト名は既に使われています。', 'custom'),
    ]);

    expect(SERVER_FIELD_ERROR_TYPE).toBe('server');
    expect(control.getFieldState('title').error?.type).toBe(
      SERVER_FIELD_ERROR_TYPE,
    );
    expectTypeOf<
      Extract<z.core.$ZodIssueCode, typeof SERVER_FIELD_ERROR_TYPE>
    >().toBeNever();
  });

  test('詳細が無ければ何もしない', () => {
    const { form, control, focused } = createForm();

    const { unmatched } = applyServerFieldErrors(form, []);

    expect(unmatched).toEqual([]);
    expect(focused).toEqual([]);
    expect(control.getFieldState('title').error).toBeUndefined();
  });

  describe('欄をまとめた値の経路', () => {
    test('値がオブジェクトの親の経路の詳細は、欄のエラーにせず対応しない詳細として返す', () => {
      const { form, control } = createForm();
      const makerDetail = detail('maker', '作成者の情報を確認してください。');

      const { unmatched } = applyServerFieldErrors(form, [makerDetail]);

      expect(unmatched).toEqual([makerDetail]);
      expect(control.getFieldState('maker').error).toBeUndefined();
      expect(control.getFieldState('maker.name').error).toBeUndefined();
    });

    test('プロトタイプがnullの値の経路も、react-hook-formと同じく欄をまとめた値として扱い、欄のエラーにしない', () => {
      const extra = Object.assign(
        Object.create(null) as Record<string, string>,
        { name: '' },
      );
      const control = createFormControl<{ extra: Record<string, string> }>({
        defaultValues: { extra },
      });
      const form = {
        getValues: control.getValues,
        setError: control.setError,
        isFieldDisabled: () => false,
        isFieldMounted: () => true,
      };
      const extraDetail = detail('extra', '追加の情報を確認してください。');

      const { unmatched } = applyServerFieldErrors(form, [extraDetail]);

      expect(unmatched).toEqual([extraDetail]);
      expect(control.getFieldState('extra').error).toBeUndefined();
    });

    test('配列・日時・nullの値の経路は欄のエラーにする', () => {
      const { form, control } = createForm();

      const { unmatched } = applyServerFieldErrors(form, [
        detail('links', 'URLは5件以内で入力してください。'),
        detail('launchedAt', '公開日を確認してください。'),
        detail('note', 'メモを確認してください。'),
      ]);

      expect(unmatched).toEqual([]);
      expect(control.getFieldState('links').error?.message).toBe(
        'URLは5件以内で入力してください。',
      );
      expect(control.getFieldState('launchedAt').error?.message).toBe(
        '公開日を確認してください。',
      );
      expect(control.getFieldState('note').error?.message).toBe(
        'メモを確認してください。',
      );
    });

    test('親の経路の詳細の後に欄の詳細が来ても、その欄へフォーカスを移す', () => {
      const { form, focused } = createForm();

      applyServerFieldErrors(form, [
        detail('maker', '作成者の情報を確認してください。'),
        detail('title', '製品名を入力してください。'),
        detail('tagline', 'キャッチコピーを入力してください。'),
      ]);

      expect(focused).toEqual(['title']);
    });
  });

  describe('無効の欄の経路', () => {
    test('無効の欄とその子の経路の詳細は、欄のエラーにせず対応しない詳細として返し、フォーカスを移さない', () => {
      const { form, control, focused } = createForm({
        disabled: ['title', 'links'],
      });
      const titleDetail = detail('title', '製品名を入力してください。');
      const linkDetail = detail('links.0', 'URLの形式で入力してください。');

      const { unmatched } = applyServerFieldErrors(form, [
        titleDetail,
        linkDetail,
        detail('tagline', 'キャッチコピーを入力してください。'),
      ]);

      expect(unmatched).toEqual([titleDetail, linkDetail]);
      expect(control.getFieldState('title').error).toBeUndefined();
      expect(control.getFieldState('links.0').error).toBeUndefined();
      expect(control.getFieldState('tagline').error?.message).toBe(
        'キャッチコピーを入力してください。',
      );
      expect(focused).toEqual(['tagline']);
    });

    test('無効の欄の親や兄弟の欄の詳細は、欄のエラーにする', () => {
      const { form, control } = createForm({ disabled: ['links.0'] });

      const { unmatched } = applyServerFieldErrors(form, [
        detail('links', 'URLは5件以内で入力してください。'),
        detail('title', '製品名を入力してください。'),
      ]);

      expect(unmatched).toEqual([]);
      expect(control.getFieldState('links').error?.message).toBe(
        'URLは5件以内で入力してください。',
      );
      expect(control.getFieldState('title').error?.message).toBe(
        '製品名を入力してください。',
      );
    });
  });

  describe('描かれていない欄の経路', () => {
    test('描かれていない欄の詳細は、欄のエラーにせず対応しない詳細として返し、フォーカスを移さない', () => {
      const { form, control, focused } = createForm({
        unmounted: ['tagline', 'links.0'],
      });
      const taglineDetail = detail(
        'tagline',
        'キャッチコピーを入力してください。',
      );
      const linkDetail = detail('links.0', 'URLの形式で入力してください。');

      const { unmatched } = applyServerFieldErrors(form, [
        taglineDetail,
        linkDetail,
        detail('title', '製品名を入力してください。'),
      ]);

      expect(unmatched).toEqual([taglineDetail, linkDetail]);
      expect(control.getFieldState('tagline').error).toBeUndefined();
      expect(control.getFieldState('links.0').error).toBeUndefined();
      expect(control.getFieldState('title').error?.message).toBe(
        '製品名を入力してください。',
      );
      expect(focused).toEqual(['title']);
    });

    test('描かれていない欄だけに詳細があれば、どの欄へもフォーカスを移さない', () => {
      const { form, focused } = createForm({ unmounted: ['maker.name'] });
      const makerDetail = detail('maker.name', '作成者名を入力してください。');

      const { unmatched } = applyServerFieldErrors(form, [makerDetail]);

      expect(unmatched).toEqual([makerDetail]);
      expect(focused).toEqual([]);
    });
  });
});
