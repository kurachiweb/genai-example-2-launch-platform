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
  const { control, getValues, getErrors, getFieldState, setValue } =
    createFormControl<ProductForm>({
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
  // 利用者が欄から離れた時と同じく、欄を触れた状態にする
  const touch = (...names: (typeof REGISTERED_FIELDS)[number][]) => {
    for (const name of names) {
      setValue(name, getValues(name), { shouldTouch: true });
    }
  };
  return { control, getValues, getErrors, getFieldState, touch };
};

const targetsOf = ({
  control,
  getValues,
  getErrors,
  getFieldState,
}: ReturnType<typeof createControl>) =>
  revalidationTargetsOf({
    errors: getErrors(),
    values: getValues(),
    isFieldMounted: (path) => MOUNTED_FIELDS.has(path),
    isFieldTouched: (path) => getFieldState(path).isTouched,
    isFieldArray: (path) => control._names.array.has(path),
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

  test('描かれていて触れた欄は、エラーが無くても入れ子と一覧の中の経路を含めて対象にし、まだ触れていない欄は対象にしない', () => {
    const form = createControl();

    form.touch('title', 'maker.name', 'links.0.url');

    expect(targetsOf(form).toSorted()).toEqual([
      'links.0.url',
      'maker.name',
      'title',
    ]);
  });

  test('描かれていない触れた欄と、描かれていてサーバーの欄のエラーが付いた触れた欄は対象にしない', () => {
    const form = createControl();
    form.touch('title', 'tagline', UNMOUNTED_FIELD);
    form.control.setError('title', serverError);

    expect(targetsOf(form)).toEqual(['tagline']);
  });

  test('触れた欄にエラーも付いていれば、名前に1回だけ含める', () => {
    const form = createControl();
    form.touch('title');
    form.control.setError('title', {
      type: 'too_small',
      message: '必須です。',
    });

    expect(targetsOf(form)).toEqual(['title']);
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
  const { control, getValues, getErrors, trigger } =
    createFormControl<LinksForm>({
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
        errors: getErrors(),
        values: getValues(),
        isFieldMounted: (path) => path === 'links.0.url',
        isFieldTouched: () => false,
        isFieldArray: (path) => path === 'links',
      }),
    );
  };
  const messageAt = (path: string): unknown =>
    get(getErrors(), `${path}.message`);
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

describe('rulesを持つ一覧の中の触れた欄の切り替えによる置き換え', () => {
  const LINK_FIELDS = ['links.0.url', 'links.1.url', 'links.2.url'] as const;

  // useFieldArrayにrulesを渡すと、一覧の経路そのものも登録されて描かれている欄(_f.mountが真)になる
  const createRulesLinksForm = () => {
    let schemaName: SchemaName = 'atLeastOne';
    const created = createFormControl<LinksForm>({
      defaultValues: { links: [{ url: '' }, { url: '' }, { url: '' }] },
      resolver: async (values, context, options) =>
        zodResolver(SCHEMAS[schemaName])(values, context, options),
    });
    const { control } = created;
    control._names.array.add('links');
    control.register('links', { required: false });
    for (const name of LINK_FIELDS) {
      control.register(name).ref(fieldElement(name));
    }
    const targets = () =>
      revalidationTargetsOf({
        errors: created.getErrors(),
        values: created.getValues(),
        isFieldMounted: (path) =>
          get(control._fields, `${path}._f.mount`) === true,
        isFieldTouched: (path) => created.getFieldState(path).isTouched,
        isFieldArray: (path) => control._names.array.has(path),
      });
    const switchTo = async (next: SchemaName) => {
      schemaName = next;
      await created.trigger(targets());
    };
    const messageAt = (path: string): unknown =>
      get(created.getErrors(), `${path}.message`);
    return { created, targets, switchTo, messageAt };
  };

  test('一覧の中の欄に触れても一覧の経路そのものを名前に入れず、触れた中の欄だけを対象にする', () => {
    const form = createRulesLinksForm();
    form.created.setValue('links.0.url', '', { shouldTouch: true });
    form.created.setError('links.1.url', {
      type: SERVER_FIELD_ERROR_TYPE,
      message: URL_TAKEN,
    });

    expect(form.created.getFieldState('links').isTouched).toBe(true);
    expect(form.targets()).toEqual(['links.0.url']);
  });

  test('切り替えると、描かれている中の欄のサーバーのエラーを残し、まだ触れていない中の欄にエラーを出さない', async () => {
    const form = createRulesLinksForm();
    form.created.setValue('links.0.url', '', { shouldTouch: true });
    form.created.setError('links.1.url', {
      type: SERVER_FIELD_ERROR_TYPE,
      message: URL_TAKEN,
    });

    await form.switchTo('atLeastTwo');

    expect(form.messageAt('links.0.url')).toBe(URL_REQUIRED);
    expect(form.messageAt('links.1.url')).toBe(URL_TAKEN);
    expect(form.messageAt('links.2.url')).toBeUndefined();
  });
});

describe('触れた欄の候補にする値の経路', () => {
  class Coordinates {
    readonly latitude = 35;
  }

  test('配列とコンストラクタがObjectの値の中だけを辿り、Date・File・独自のクラスの値の中へは入らない', () => {
    const values = {
      launchedAt: Object.assign(new Date('2026-10-28T00:00:00Z'), {
        zone: 'UTC',
      }),
      attachment: Object.assign(new File(['x'], 'pitch.txt'), {
        label: '資料',
      }),
      coordinates: new Coordinates(),
      maker: { name: 'Pitch Notes' },
      tags: ['launch'],
    };

    const targets = revalidationTargetsOf<typeof values>({
      errors: {},
      values,
      isFieldMounted: () => true,
      isFieldTouched: () => true,
      isFieldArray: () => false,
    });

    expect(targets.toSorted()).toEqual([
      'attachment',
      'coordinates',
      'launchedAt',
      'maker',
      'maker.name',
      'tags',
      'tags.0',
    ]);
  });
});
