import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodResolver } from '@hookform/resolvers/zod';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  type Control,
  createFormControl,
  type FieldValues,
  get,
  type Resolver,
  type UseFieldArrayProps,
  type UseFormProps,
  type UseFormReturn,
  useFieldArray,
  useForm,
} from 'react-hook-form';

import { z } from '../../utilities/validation/zod.ts';

const LIBRARY_ROOT = join(import.meta.dir, '..', '..');

const REVIEW_PROCEDURE =
  'docs/GUIDES/tech/coding/002-dependency-versions.md#内部の値に頼るパッケージの版を上げる手順';

const VERIFIED_VERSIONS = {
  'react-hook-form': '7.91.0',
  '@hookform/resolvers': '6.0.2',
} as const;

type GuardedPackage = keyof typeof VERIFIED_VERSIONS;

type InstalledVersions = Readonly<Record<GuardedPackage, string | undefined>>;

interface BrowserTestReference {
  readonly file: string;
  readonly name: string;
}

interface ReviewItem {
  readonly subject: string;
  readonly usedIn: readonly string[];
  readonly unitTests: readonly string[];
  readonly browserTests: readonly BrowserTestReference[];
}

const THIS_TEST = 'components/form/form-library-internals.unit.test.ts';
const UNMATCHED_FIELDS_TEST =
  'components/form/form-unmatched-fields.browser.test.tsx';

const REVIEW_ITEMS: readonly ReviewItem[] = [
  {
    subject:
      '`control._names.disabled`に、登録の`disabled`とフォーム全体の`disabled`で無効になった欄の名前が入り、有効に戻すと除かれ、描かなくなっても残ること(`FormField`(`useController`)の経路(描画中の`register`、効果の中の`_setDisabledField`)は一覧のブラウザテストで確かめる)',
    usedIn: ['components/form/app-form.tsx', 'components/form/use-app-form.ts'],
    unitTests: [
      THIS_TEST,
      'utilities/forms/disabled-field-errors.unit.test.ts',
    ],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'FormFieldのdisabledで無効にした欄の詳細は、欄に付けず送信の失敗として渡し、無効の欄の値を送信の値に含めない',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '無効の欄のスキーマが%sでも、欄の再検証の後に送信ボタンが無効に戻らない',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'サーバーのエラーが付いた欄を後から無効にすると、エラーの表示を消し、他の欄が正しければ送信ボタンを有効にする',
      },
    ],
  },
  {
    subject:
      '`handleSubmit`が`control._names.disabled`の欄の値を送信の値から外すこと',
    usedIn: ['components/form/app-form.tsx'],
    unitTests: [THIS_TEST],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'FormFieldのdisabledで無効にした欄の詳細は、欄に付けず送信の失敗として渡し、無効の欄の値を送信の値に含めない',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '任意にした無効の欄の値がスキーマを通らなくても、他の欄を正しく入力すると送信でき、変換を通った値を渡す',
      },
    ],
  },
  {
    subject:
      '`control._fields`の欄の`_f.mount`が、描かれている間は真で、描かなくなると名前が`_names.mount`に残ったまま偽になること(`FormField`(`useController`)の経路(描画中の`register`、効果の中の`updateMounted`)は一覧のブラウザテストで確かめる)',
    usedIn: [
      'components/form/field-mount.ts',
      'components/form/app-form.tsx',
      'components/form/use-app-form.ts',
    ],
    unitTests: [THIS_TEST, 'components/form/field-mount.unit.test.ts'],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '$state欄の詳細は、欄に付けず送信の失敗として渡し、送信ボタンを有効のままにする',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '切り替えても、描かれている欄のサーバーのエラーは残し、その欄を直すまで送信ボタンを無効にする',
      },
    ],
  },
  {
    subject:
      '`useFieldArray`が`rules`の有無によらず一覧の名前を`control._names.array`に入れ、`rules`の無い一覧の経路は`_fields`に`_f`を持たず、`rules`を持つ一覧の経路は描かれている欄(`_f.mount`が真)になること',
    usedIn: ['components/form/app-form.tsx', 'components/form/use-app-form.ts'],
    unitTests: [THIS_TEST, 'utilities/forms/revalidation-targets.unit.test.ts'],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'rulesを持たない一覧を描いている間は、一覧の経路そのものの詳細を欄のエラーにする',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'rulesを持つ一覧の中の欄に触れて切り替えても、一覧の中の欄のサーバーのエラーを残し、まだ触れていない一覧の中の欄にエラーを出さない',
      },
    ],
  },
  {
    subject:
      '名前の配列を渡した`trigger`が、全欄の検証の結果で`isValid`を計算し直し、渡した名前のエラーだけを置き換えること',
    usedIn: [
      'components/form/use-app-form.ts',
      'utilities/forms/revalidation-targets.ts',
    ],
    unitTests: [THIS_TEST, 'utilities/forms/revalidation-targets.unit.test.ts'],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '描いていた欄に検証のエラーを出した後に描かない条件へ切り替えると、新しいスキーマの結果で送信ボタンを有効にし、送信できる',
      },
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '切り替えると、描かれている欄に表示中の検証のエラーを新しい規則の結果に置き換え、新しい規則で正しければ消して送信ボタンを有効にし、送信できる',
      },
    ],
  },
  {
    subject:
      '`@hookform/resolvers`の`toNestErrors`が、検証する名前に一覧の中の経路がある時だけ一覧全体のエラーを`<一覧>.root`へ入れ子にすること',
    usedIn: ['utilities/forms/revalidation-targets.ts'],
    unitTests: [THIS_TEST, 'utilities/forms/revalidation-targets.unit.test.ts'],
    browserTests: [],
  },
  {
    subject:
      '`setError`が欄のエラーに常に`ref`のキーを付け、種類も文言も持たない`setError(name, {})`も欄のエラーとして持つこと(型では`ref`は任意)',
    usedIn: [
      'utilities/forms/revalidation-targets.ts',
      'utilities/forms/reserved-field-names.ts',
    ],
    unitTests: [THIS_TEST, 'utilities/forms/revalidation-targets.unit.test.ts'],
    browserTests: [],
  },
  {
    subject:
      'resolverが受け取る`values`がフォームの値(`control._formValues`)そのもので、欄ごとの検証でも全欄の値を受け取ること',
    usedIn: ['utilities/forms/disabled-field-errors.ts'],
    unitTests: [
      THIS_TEST,
      'utilities/forms/disabled-field-errors.unit.test.ts',
    ],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '無効の欄を任意にしないスキーマでも、無効の欄の検証エラーで送信ボタンを無効のまま残さず送信できる',
      },
    ],
  },
  {
    subject:
      '`useForm`が描画のたびに`control._options`を置き換え、最後の描画で渡したresolverで検証すること',
    usedIn: ['components/form/use-app-form.ts'],
    unitTests: [THIS_TEST],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '切り替えると、描かれている欄に表示中の検証のエラーが新しい規則でも残る場合は、新しい規則の文言にする',
      },
    ],
  },
  {
    subject:
      'フォームの値の複製(`cloneObject`)が、配列と、プロトタイプがnullかコンストラクタが`Object`の値の中だけを入れ子として複製し、他のオブジェクトを欄の値として扱うこと',
    usedIn: [
      'utilities/forms/server-field-errors.ts',
      'utilities/forms/reserved-field-names.ts',
    ],
    unitTests: [
      THIS_TEST,
      'utilities/forms/server-field-errors.unit.test.ts',
      'utilities/forms/reserved-field-names.unit.test.ts',
    ],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: 'サーバーの詳細が欄をまとめた値の経路に付くと、欄に付けず送信の失敗として渡し、送信ボタンを有効のままにする',
      },
    ],
  },
  {
    subject: '`getErrors`がフォームの状態の購読を増やさないこと',
    usedIn: ['components/form/use-app-form.ts'],
    unitTests: [THIS_TEST],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '切り替えで検証し直す欄を選ぶために欄のエラーを読んでも、フォームを作る部品は欄のエラーの変化で描き直さない',
      },
    ],
  },
  {
    subject:
      '`getFieldState`がフォームの状態の購読を増やさず、触れた状態(`touchedFields`)を購読していないフォームでも、欄から離れた時に記録した値で入れ子と一覧の中の欄の`isTouched`を答えること',
    usedIn: ['components/form/use-app-form.ts'],
    unitTests: [THIS_TEST, 'utilities/forms/revalidation-targets.unit.test.ts'],
    browserTests: [
      {
        file: UNMATCHED_FIELDS_TEST,
        name: '切り替えると、触れてエラーの無い欄が新しい規則で違反ならエラーを表示して送信ボタンを無効にし、まだ触れていない欄にはエラーを出さない',
      },
    ],
  },
];

const UNKNOWN_VERSION = '不明';

const browserTestLabel = ({ file, name }: BrowserTestReference): string =>
  `${file}「${name}」`;

const reviewItemLines = (item: ReviewItem, index: number): string[] => [
  `${String(index + 1)}. ${item.subject}`,
  `   使う箇所: ${item.usedIn.join('、')}`,
  `   確かめる単体テスト: ${item.unitTests.join('、')}`,
  ...item.browserTests.map(
    (reference) => `   確かめるブラウザテスト: ${browserTestLabel(reference)}`,
  ),
];

const reviewReportOf = (installed: InstalledVersions): string | undefined => {
  const mismatches = (
    Object.keys(VERIFIED_VERSIONS) as GuardedPackage[]
  ).flatMap((packageName) => {
    const verified = VERIFIED_VERSIONS[packageName];
    const version = installed[packageName];
    return version === verified
      ? []
      : [
          `- ${packageName}: 確かめた版 ${verified}、導入済みの版 ${version ?? UNKNOWN_VERSION}`,
        ];
  });
  if (mismatches.length === 0) {
    return undefined;
  }
  return [
    'フォームの部品が頼る内部の値と公開されていない振る舞いを確かめた版と、導入済みの版が異なります。',
    ...mismatches,
    `見直しの手順: ${REVIEW_PROCEDURE}`,
    '見直す項目と、その項目を確かめるテスト:',
    ...REVIEW_ITEMS.flatMap(reviewItemLines),
    'すべての項目を確かめた後に、このファイルのVERIFIED_VERSIONSを導入済みの版に書き換えてください。',
  ].join('\n');
};

const assertVerifiedVersions = (installed: InstalledVersions): void => {
  const report = reviewReportOf(installed);
  if (report !== undefined) {
    throw new Error(report);
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const installedVersionOf = (
  packageName: GuardedPackage,
): string | undefined => {
  const manifest: unknown = JSON.parse(
    readFileSync(
      Bun.resolveSync(`${packageName}/package.json`, import.meta.dir),
      'utf8',
    ),
  );
  const version = isRecord(manifest) ? manifest['version'] : undefined;
  return typeof version === 'string' ? version : undefined;
};

// 確かめた版を書き換えても版の比較の検査が成り立つよう、異なる版は確かめた版から作る
const changedVersionOf = (packageName: GuardedPackage): string =>
  `${VERIFIED_VERSIONS[packageName]}-changed`;

const installedVersions = (): InstalledVersions => ({
  'react-hook-form': installedVersionOf('react-hook-form'),
  '@hookform/resolvers': installedVersionOf('@hookform/resolvers'),
});

describe('フォームのライブラリの版の番人', () => {
  test('導入済みの版が、内部の値と公開されていない振る舞いを確かめた版と一致する', () => {
    assertVerifiedVersions(installedVersions());
  });

  describe('版の比較', () => {
    test('どちらの版も確かめた版と一致すれば失敗しない', () => {
      expect(() => {
        assertVerifiedVersions({ ...VERIFIED_VERSIONS });
      }).not.toThrow();
    });

    test.each(Object.keys(VERIFIED_VERSIONS) as GuardedPackage[])(
      '%sの版が異なると、両方の版と見直しの手順の文書を示して失敗する',
      (packageName) => {
        const version = changedVersionOf(packageName);
        const installed = { ...VERIFIED_VERSIONS, [packageName]: version };

        expect(() => {
          assertVerifiedVersions(installed);
        }).toThrow(
          `${packageName}: 確かめた版 ${VERIFIED_VERSIONS[packageName]}、導入済みの版 ${version}`,
        );
        expect(() => {
          assertVerifiedVersions(installed);
        }).toThrow(REVIEW_PROCEDURE);
      },
    );

    test('版を読めないと、読めないことを示して失敗する', () => {
      expect(() => {
        assertVerifiedVersions({
          ...VERIFIED_VERSIONS,
          'react-hook-form': undefined,
        });
      }).toThrow(
        `react-hook-form: 確かめた版 ${VERIFIED_VERSIONS['react-hook-form']}、導入済みの版 不明`,
      );
    });

    test('版が異なると、見直す項目ごとに使う箇所と確かめるテストのファイルを示す', () => {
      const report = reviewReportOf({
        ...VERIFIED_VERSIONS,
        'react-hook-form': changedVersionOf('react-hook-form'),
      });

      for (const item of REVIEW_ITEMS) {
        expect(report).toContain(item.subject);
        for (const file of [...item.usedIn, ...item.unitTests]) {
          expect(report).toContain(file);
        }
        for (const { file, name } of item.browserTests) {
          expect(report).toContain(`${file}「${name}」`);
        }
      }
    });
  });

  describe('見直す項目の一覧', () => {
    test('使う箇所と確かめるテストのファイルが存在し、ブラウザテストの名前がそのファイルにある', () => {
      for (const item of REVIEW_ITEMS) {
        for (const file of [...item.usedIn, ...item.unitTests]) {
          expect(existsSync(join(LIBRARY_ROOT, file)), file).toBe(true);
        }
        for (const reference of item.browserTests) {
          const content = readFileSync(
            join(LIBRARY_ROOT, reference.file),
            'utf8',
          );
          expect(
            content.includes(`'${reference.name}'`),
            browserTestLabel(reference),
          ).toBe(true);
        }
      }
    });

    test('フォームのライブラリの内部の値を読むファイルは、すべて一覧の使う箇所にある', () => {
      const usedIn = new Set(REVIEW_ITEMS.flatMap((item) => item.usedIn));
      const glob = new Bun.Glob(
        '{components,utilities,server,start}/**/*.{ts,tsx}',
      );
      const readers = [...glob.scanSync(LIBRARY_ROOT)].filter(
        (file) =>
          !/\.(?:test|stories)\.tsx?$/u.test(file) &&
          INTERNAL_VALUE_ACCESS.test(
            readFileSync(join(LIBRARY_ROOT, file), 'utf8'),
          ),
      );

      expect(readers.length).toBeGreaterThan(0);
      expect(readers.filter((file) => !usedIn.has(file))).toEqual([]);
    });
  });
});

// フォームのライブラリの内部の値は先頭に`_`の付いた名前で、分割代入(`{ _fields: fields }`)と`in`の判定(`'_f' in field`)でも読まれる
const INTERNAL_VALUE_ACCESS = /(?:\.|\{\s*|'|,\s*)_[A-Za-z]\w*\b/u;

interface ProductForm {
  title: string;
  tagline: string;
  maker: { name: string };
  links: { url: string }[];
}

const DEFAULT_VALUES: ProductForm = {
  title: '',
  tagline: '',
  maker: { name: '' },
  links: [{ url: '' }],
};

const fieldElement = (name: string) => ({
  name,
  value: '',
  focus: () => undefined,
});

const mountOf = <T extends FieldValues>(
  control: Control<T>,
  path: string,
): unknown => get<unknown>(control._fields, `${path}._f.mount`);

describe('フォームの部品が頼る内部の値', () => {
  describe('無効の欄の集合(_names.disabled)', () => {
    test('登録で無効にした欄の名前が入り、描いたまま有効に戻すと除かれる', () => {
      const { control } = createFormControl<ProductForm>({
        defaultValues: DEFAULT_VALUES,
      });

      control.register('title', { disabled: true }).ref(fieldElement('title'));
      control.register('tagline').ref(fieldElement('tagline'));

      expect([...control._names.disabled]).toEqual(['title']);

      control.register('title', { disabled: false });

      expect([...control._names.disabled]).toEqual([]);
    });

    test('無効の欄を描かなくなっても、名前が残る', () => {
      const { control } = createFormControl<ProductForm>({
        defaultValues: DEFAULT_VALUES,
      });
      const registration = control.register('title', { disabled: true });
      registration.ref(fieldElement('title'));

      registration.ref(null);

      expect(control._names.disabled.has('title')).toBe(true);
    });

    test('フォーム全体を無効にすると、登録した欄の名前が入る', () => {
      const { control } = createFormControl<ProductForm>({
        defaultValues: DEFAULT_VALUES,
        disabled: true,
      });

      control.register('title').ref(fieldElement('title'));

      expect(control._names.disabled.has('title')).toBe(true);
    });
  });

  test('送信(handleSubmit)は、描かなくなった欄を含め無効の欄の値を送信の値から外す', async () => {
    const created = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });
    const { control } = created;
    control.register('title', { disabled: true }).ref(fieldElement('title'));
    const tagline = control.register('tagline', { disabled: true });
    tagline.ref(fieldElement('tagline'));
    tagline.ref(null);
    control.register('maker.name').ref(fieldElement('maker.name'));
    const onValid = mock<(values: unknown) => void>();

    await created.handleSubmit(onValid)();

    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid.mock.calls[0]?.[0]).toStrictEqual({
      maker: { name: '' },
      links: [{ url: '' }],
    });
  });

  test('欄の描画の状態(_f.mount)は、描かれている間は真で、描かなくなると名前が登録に残ったまま偽になる', () => {
    const { control } = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });
    const registration = control.register('maker.name');
    registration.ref(fieldElement('maker.name'));

    expect(mountOf(control, 'maker.name')).toBe(true);

    registration.ref(null);

    expect(mountOf(control, 'maker.name')).toBe(false);
    expect(control._names.mount.has('maker.name')).toBe(true);
  });

  test('rulesの無いuseFieldArrayは一覧の名前を一覧の名前の集合(_names.array)に入れ、一覧の経路は_fを持たない', () => {
    const { control } = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });

    renderToString(createElement(FieldArrayProbe, { control }));

    expect(control._names.array.has('links')).toBe(true);
    expect(get(control._fields, 'links._f')).toBeUndefined();
  });

  test('rulesを持つuseFieldArrayも一覧の名前を一覧の名前の集合に入れ、一覧の経路は描かれている欄になる', () => {
    const { control } = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });

    renderToString(
      createElement(FieldArrayProbe, { control, rules: { maxLength: 5 } }),
    );

    expect(control._names.array.has('links')).toBe(true);
    expect(mountOf(control, 'links')).toBe(true);
  });

  test('useFormは描画のたびに設定を置き換え、最後の描画で渡したresolverで検証する', async () => {
    const created = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });
    const passing: Resolver<ProductForm> = (values) => ({ values, errors: {} });
    const first = mock(passing);
    const second = mock(passing);

    renderToString(
      createElement(FormProbe, {
        options: { formControl: created.formControl, resolver: first },
      }),
    );
    renderToString(
      createElement(FormProbe, {
        options: { formControl: created.formControl, resolver: second },
      }),
    );
    await created.trigger();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('名前の配列を渡したtriggerは、全欄の検証の結果でisValidを計算し直し、渡した名前のエラーだけを置き換える', async () => {
    const schema = z.object({
      title: z.string().min(1, 'プロダクト名を入力してください。'),
      tagline: z.string().min(1, 'キャッチコピーを入力してください。'),
    });
    const created = createFormControl<z.input<typeof schema>>({
      defaultValues: { title: 'Pitch Notes', tagline: '' },
      resolver: zodResolver(schema),
    });
    const { control } = created;
    control.register('title').ref(fieldElement('title'));
    control.register('tagline').ref(fieldElement('tagline'));
    control.setError('title', { type: 'custom', message: '古い規則の文言' });
    control.setError('tagline', { type: 'custom', message: '利用側の文言' });
    const validity: unknown[] = [];
    created.subscribe({
      formState: { isValid: true },
      callback: ({ isValid }) => {
        validity.push(isValid);
      },
    });

    await created.trigger(['title']);

    expect(created.getErrors('title')).toBeUndefined();
    expect(created.getErrors('tagline')?.message).toBe('利用側の文言');
    expect(validity.at(-1)).toBe(false);
  });

  test.each([
    { state: '描かれている', registered: true },
    { state: '登録の無い', registered: false },
  ])(
    'setErrorは、$state欄に種類も文言も持たないエラーを付けても、refのキーを持つ欄のエラーにする',
    ({ registered }) => {
      const created = createFormControl<ProductForm>({
        defaultValues: DEFAULT_VALUES,
      });
      if (registered) {
        created.control.register('title').ref(fieldElement('title'));
      }

      created.setError('title', {});

      const error: unknown = created.getErrors().title;
      expect(isRecord(error) && Object.hasOwn(error, 'ref')).toBe(true);
      expect(isRecord(error) ? Object.keys(error) : []).toEqual(['ref']);
    },
  );

  describe('一覧全体のエラーの入れ子(@hookform/resolversのtoNestErrors)', () => {
    const linksSchema = z.object({
      title: z.string(),
      links: z
        .array(z.object({ url: z.string() }))
        .min(2, 'リンクは2件以上入力してください。'),
    });
    const resolve = (names: readonly string[]) =>
      zodResolver(linksSchema)({ title: '', links: [{ url: '' }] }, undefined, {
        fields: {},
        names: [...names],
        shouldUseNativeValidation: false,
      });

    test('検証する名前に一覧の中の経路があれば、一覧全体のエラーを<一覧>.rootに入れる', async () => {
      const { errors } = await resolve(['title', 'links.1']);

      expect(get(errors, 'links.root.message')).toBe(
        'リンクは2件以上入力してください。',
      );
    });

    test('検証する名前に一覧の中の経路が無ければ、一覧全体のエラーを一覧の経路に付ける', async () => {
      const { errors } = await resolve(['title', 'links']);

      expect(get(errors, 'links.message')).toBe(
        'リンクは2件以上入力してください。',
      );
      expect(get(errors, 'links.root')).toBeUndefined();
    });
  });

  test('resolverは、欄ごとの検証でもフォームの値そのもの(全欄)と検証する名前を受け取る', async () => {
    const received: { values: unknown; names: unknown }[] = [];
    const created = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
      resolver: (values, _context, options) => {
        received.push({ values, names: options.names });
        return { values, errors: {} };
      },
    });
    created.control.register('title').ref(fieldElement('title'));

    await created.trigger('title');

    expect(received).toHaveLength(1);
    expect(received[0]?.values).toBe(created.control._formValues);
    expect(received[0]?.values).toStrictEqual(DEFAULT_VALUES);
    expect(received[0]?.names).toEqual(['title']);
  });

  test('フォームの値の複製は、配列と、プロトタイプがnullかコンストラクタがObjectの値の中だけを複製し、他のオブジェクトは同じ参照のまま持つ', () => {
    class Coordinates {
      readonly latitude = 35;
    }
    const maker = { name: 'Pitch Notes' };
    const tags = ['a'];
    const coordinates = new Coordinates();
    const bareRecord: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    const attachment = new File(['x'], 'pitch.txt');
    const launchedAt = new Date('2026-10-28T00:00:00Z');
    const { getValues } = createFormControl({
      defaultValues: {
        maker,
        tags,
        coordinates,
        bareRecord,
        attachment,
        launchedAt,
      },
    });

    const values = getValues();

    expect(values.maker).not.toBe(maker);
    expect(values.maker).toStrictEqual(maker);
    expect(values.tags).not.toBe(tags);
    expect(values.coordinates).toBe(coordinates);
    expect(values.bareRecord).not.toBe(bareRecord);
    expect(values.bareRecord).toStrictEqual(bareRecord);
    expect(values.attachment).toBe(attachment);
    expect(values.launchedAt).toBeInstanceOf(Date);
    expect(values.launchedAt.getTime()).toBe(launchedAt.getTime());
  });

  test('getErrorsはフォームの状態のエラーの購読を増やさず、formStateから読むと増える', () => {
    const viaGetErrors = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });
    const viaFormState = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });

    renderToString(
      createElement(FormProbe, {
        options: { formControl: viaGetErrors.formControl },
        read: (form) => form.getErrors(),
      }),
    );
    renderToString(
      createElement(FormProbe, {
        options: { formControl: viaFormState.formControl },
        read: (form) => form.formState.errors,
      }),
    );

    expect(viaGetErrors.control._proxyFormState.errors).toBe(false);
    expect(viaFormState.control._proxyFormState.errors).not.toBe(false);
  });

  test('getFieldStateは触れた状態の購読を増やさず、購読していなくても欄から離れた時に記録した入れ子と一覧の中の欄の触れた状態を答える', async () => {
    const created = createFormControl<ProductForm>({
      defaultValues: DEFAULT_VALUES,
    });
    renderToString(
      createElement(FormProbe, {
        options: { formControl: created.formControl },
        read: (form) => form.getFieldState('title'),
      }),
    );
    const touchedNames = ['maker.name', 'links.0.url'] as const;
    for (const name of [...touchedNames, 'title'] as const) {
      created.control.register(name).ref(fieldElement(name));
    }

    for (const name of touchedNames) {
      await created.control
        .register(name)
        .onBlur({ target: { name, value: '' }, type: 'blur' });
    }

    expect(created.control._proxyFormState.touchedFields).toBe(false);
    expect(
      touchedNames.map((name) => created.getFieldState(name).isTouched),
    ).toEqual([true, true]);
    expect(created.getFieldState('title').isTouched).toBe(false);
  });
});

function FieldArrayProbe({
  control,
  rules,
}: {
  readonly control: Control<ProductForm>;
  readonly rules?: UseFieldArrayProps<ProductForm, 'links'>['rules'];
}) {
  useFieldArray({ control, name: 'links', rules });
  return null;
}

function FormProbe({
  options,
  read,
}: {
  readonly options: UseFormProps<ProductForm>;
  readonly read?: (form: UseFormReturn<ProductForm>) => unknown;
}) {
  const form = useForm<ProductForm>(options);
  read?.(form);
  return null;
}
