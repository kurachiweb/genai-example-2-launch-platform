import { describe, expect, test } from 'bun:test';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFormControl, get } from 'react-hook-form';

import { z } from '../validation/zod.ts';
import { revalidationTargetsOf } from './revalidation-targets.ts';
import { SERVER_FIELD_ERROR_TYPE } from './server-field-errors.ts';

interface ProductForm {
  title: string;
  tagline: string;
  contact: string;
  maker: { name: string };
  links: { url: string }[];
}

const REGISTERED_FIELDS = [
  'title',
  'tagline',
  'contact',
  'maker.name',
  'links.0.url',
] as const;

const UNMOUNTED_FIELD = 'contact';

// 描かれている欄の判定は利用側(useAppForm)が渡す。ここでは登録して描いたままの欄を描かれている欄とする
const MOUNTED_FIELDS: ReadonlySet<string> = new Set(
  REGISTERED_FIELDS.filter((name) => name !== UNMOUNTED_FIELD),
);

// 描かれている欄のDOM要素は、エラーの形に似たオブジェクトを中に持ち得る
const fieldElement = (name: string) => ({
  name,
  value: '',
  focus: () => undefined,
  attributes: { message: { type: 'attribute' } },
});

const createControl = () => {
  const { control, getValues } = createFormControl<ProductForm>({
    defaultValues: {
      title: '',
      tagline: '',
      contact: '',
      maker: { name: '' },
      links: [{ url: '' }],
    },
  });
  for (const name of REGISTERED_FIELDS) {
    control.register(name).ref(fieldElement(name));
  }
  control.register(UNMOUNTED_FIELD).ref(null);
  return { control, getValues };
};

const targetsOf = ({ control, getValues }: ReturnType<typeof createControl>) =>
  revalidationTargetsOf({
    errors: control._formState.errors,
    values: getValues(),
    isFieldMounted: (path) => MOUNTED_FIELDS.has(path),
  });

const serverError = { type: SERVER_FIELD_ERROR_TYPE, message: '不正です。' };

describe('revalidationTargetsOf', () => {
  test('エラーが無ければ空の配列を返す', () => {
    const form = createControl();

    expect(targetsOf(form)).toEqual([]);
  });

  test('描かれている欄の検証のエラーと利用側が付けたエラー、描かれていない欄のエラーを、入れ子と一覧の中の経路も含めて対象にする', () => {
    const form = createControl();
    const { control } = form;
    control.setError('title', { type: 'too_small', message: '必須です。' });
    control.setError('tagline', { type: 'taken', message: '使えません。' });
    control.setError('maker.name', {
      type: 'too_big',
      message: '長すぎます。',
    });
    control.setError('links.0.url', {
      type: 'invalid_format',
      message: 'URLの形式で入力してください。',
    });
    control.setError(UNMOUNTED_FIELD, {
      type: 'too_small',
      message: '短すぎます。',
    });

    expect(targetsOf(form).toSorted()).toEqual([
      'contact',
      'links.0.url',
      'maker.name',
      'tagline',
      'title',
    ]);
  });

  test('種類も文言も持たないエラーも欄のエラーとして対象にし、欄の要素の中へは入らない', () => {
    const form = createControl();
    form.control.setError('title', {});
    form.control.setError('tagline', { types: { taken: '使えません。' } });

    expect(targetsOf(form).toSorted()).toEqual(['tagline', 'title']);
  });

  test('描かれている欄のサーバーの欄のエラーは除き、描かれていない欄のサーバーの欄のエラーは対象にする', () => {
    const form = createControl();
    const { control } = form;
    control.setError('title', serverError);
    control.setError('maker.name', serverError);
    control.setError(UNMOUNTED_FIELD, serverError);
    control.setError('tagline', { type: 'too_small', message: '必須です。' });

    expect(targetsOf(form).toSorted()).toEqual(['contact', 'tagline']);
  });

  test('rulesの無い一覧の経路そのものは、サーバーの欄のエラーでも描かれていない欄として対象にする', () => {
    const form = createControl();
    form.control.setError('links', serverError);

    expect(targetsOf(form)).toEqual(['links']);
  });

  test('フォーム全体のrootのエラーは対象にしない', () => {
    const form = createControl();
    form.control.setError('root', {
      type: 'server',
      message: '失敗しました。',
    });
    form.control.setError('root.submit', {
      type: 'server',
      message: '送信できませんでした。',
    });

    expect(targetsOf(form)).toEqual([]);
  });
});

interface LinksForm {
  links: { url: string }[];
}

const URL_REQUIRED = 'URLを入力してください。';
const AT_LEAST_TWO = 'リンクは2件以上入力してください。';
const AT_LEAST_THREE = 'リンクは3件以上入力してください。';
const URL_TAKEN = 'このURLは既に登録されています。';

const linksSchemaOf = (min: number, message: string) =>
  z.object({
    links: z
      .array(z.object({ url: z.string().min(1, URL_REQUIRED) }))
      .min(min, message),
  });

const SCHEMAS = {
  atLeastOne: linksSchemaOf(1, 'リンクを入力してください。'),
  atLeastTwo: linksSchemaOf(2, AT_LEAST_TWO),
  atLeastThree: linksSchemaOf(3, AT_LEAST_THREE),
} as const;

type SchemaName = keyof typeof SCHEMAS;

// useAppFormと同じく、スキーマを切り替えたら対象の欄だけをtriggerで検証し直す
const createLinksForm = (url: string) => {
  let schemaName: SchemaName = 'atLeastTwo';
  const { control, getValues, trigger } = createFormControl<LinksForm>({
    defaultValues: { links: [{ url }] },
    resolver: async (values, context, options) =>
      zodResolver(SCHEMAS[schemaName])(values, context, options),
  });
  control._names.array.add('links');
  control.register('links.0.url').ref(fieldElement('links.0.url'));
  const switchTo = async (next: SchemaName) => {
    schemaName = next;
    await trigger(
      revalidationTargetsOf({
        errors: control._formState.errors,
        values: getValues(),
        isFieldMounted: (path) => path === 'links.0.url',
      }),
    );
  };
  const messageAt = (path: string): unknown =>
    get(control._formState.errors, `${path}.message`);
  // 一覧全体のエラーは、react-hook-formが古い規則で検証した結果の形(<一覧>.root)で用意する
  const validateAll = async () => {
    await trigger();
  };
  return { control, switchTo, messageAt, validateAll };
};

describe('一覧全体のエラーの切り替えによる置き換え', () => {
  test.each([
    { next: 'atLeastThree', listMessage: AT_LEAST_THREE },
    { next: 'atLeastOne', listMessage: undefined },
  ] as const)(
    '一覧全体のエラーだけがある時、規則($next)へ切り替えると一覧全体のエラーを新しい規則の結果にする',
    async ({ next, listMessage }) => {
      const form = createLinksForm('https://pitch-notes.example');
      await form.validateAll();
      expect(form.messageAt('links.root')).toBe(AT_LEAST_TWO);

      await form.switchTo(next);

      expect(form.messageAt('links.root')).toBe(listMessage);
      expect(form.messageAt('links.0.url')).toBeUndefined();
    },
  );

  test.each([
    { next: 'atLeastThree', listMessage: AT_LEAST_THREE },
    { next: 'atLeastOne', listMessage: undefined },
  ] as const)(
    '一覧全体のエラーと一覧の中の欄の検証のエラーがある時、規則($next)へ切り替えると両方を新しい規則の結果にする',
    async ({ next, listMessage }) => {
      const form = createLinksForm('');
      await form.validateAll();
      expect(form.messageAt('links.root')).toBe(AT_LEAST_TWO);
      form.control.setError('links.0.url', {
        type: 'too_small',
        message: '古い規則の文言',
      });

      await form.switchTo(next);

      expect(form.messageAt('links.root')).toBe(listMessage);
      expect(form.messageAt('links.0.url')).toBe(URL_REQUIRED);
    },
  );

  test.each([
    { next: 'atLeastThree', listMessage: AT_LEAST_THREE },
    { next: 'atLeastOne', listMessage: undefined },
  ] as const)(
    '一覧全体のエラーと描かれている一覧の中の欄のサーバーのエラーがある時、規則($next)へ切り替えると一覧全体のエラーを新しい規則の結果にし、サーバーのエラーを残す',
    async ({ next, listMessage }) => {
      const form = createLinksForm('https://pitch-notes.example');
      await form.validateAll();
      expect(form.messageAt('links.root')).toBe(AT_LEAST_TWO);
      form.control.setError('links.0.url', {
        type: SERVER_FIELD_ERROR_TYPE,
        message: URL_TAKEN,
      });

      await form.switchTo(next);

      expect(form.messageAt('links.root')).toBe(listMessage);
      expect(form.messageAt('links.0.url')).toBe(URL_TAKEN);
    },
  );
});

describe('一覧の経路そのものに付いたエラーの切り替えによる置き換え', () => {
  const LIST_CHECK = 'リンクを確認してください。';

  test.each([
    {
      state: '一覧の中の欄だけが違反',
      next: 'atLeastOne',
      url: '',
      expected: { list: undefined, listRoot: undefined, item: URL_REQUIRED },
    },
    {
      state: '一覧全体だけが違反',
      next: 'atLeastThree',
      url: 'https://pitch-notes.example',
      expected: { list: undefined, listRoot: AT_LEAST_THREE, item: undefined },
    },
    {
      state: '一覧全体と一覧の中の欄の両方が違反',
      next: 'atLeastThree',
      url: '',
      expected: { list: undefined, listRoot: AT_LEAST_THREE, item: undefined },
    },
    {
      state: '違反が無い',
      next: 'atLeastOne',
      url: 'https://pitch-notes.example',
      expected: { list: undefined, listRoot: undefined, item: undefined },
    },
  ] as const)(
    '新しい規則で$stateなら、経路の一覧で検証し直した結果にする',
    async ({ next, url, expected }) => {
      const form = createLinksForm(url);
      form.control.setError('links', {
        type: SERVER_FIELD_ERROR_TYPE,
        message: LIST_CHECK,
      });

      await form.switchTo(next);

      expect({
        list: form.messageAt('links'),
        listRoot: form.messageAt('links.root'),
        item: form.messageAt('links.0.url'),
      }).toEqual(expected);
    },
  );
});
