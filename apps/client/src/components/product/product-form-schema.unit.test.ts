import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_NAME_MAX_GRAPHEMES,
  PRODUCT_NAME_MESSAGES,
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_TAGLINE_MAX_GRAPHEMES,
  PRODUCT_TAGLINE_MESSAGES,
} from '../../../common-lib/product/product-input-rules.ts';
import { EXTERNAL_URL_MAX_LENGTH } from '../../../common-lib/url/external-url.ts';
import type { LaunchPlanView } from '../../graphql/my-products.ts';
import {
  CATEGORY_REQUIRED_MESSAGE,
  LOGO_REQUIRED_MESSAGE,
  PRODUCT_FORM_MESSAGES,
} from './product-form-messages.ts';
import {
  EDIT_PRODUCT_FORM_SCHEMAS,
  editProductFormSchemaOf,
  type ProductFormInput,
  REGISTER_PRODUCT_FORM_SCHEMA,
} from './product-form-schema.ts';

const VALID_FIELDS = Object.freeze({
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を整える',
  categoryId: '01JD0CATEGORY0000000000001',
  handle: 'pitch-notes',
  websiteUrl: 'https://pitch.example/',
  description: '## 特長\n\n台本を**整える**。',
  logoFileId: '01JD0FILE00000000000000001',
  screenshotFileIds: ['01JD0FILE00000000000000002'],
});

const VALID_INPUT: ProductFormInput = Object.freeze({
  fields: VALID_FIELDS,
  launchDate: '2026-11-20',
});

type Fields = ProductFormInput['fields'];

// 無効にしたカテゴリの欄は送る値から外れるため、その形の値を作る
const withoutCategory = <T extends { categoryId?: string }>(
  fields: T,
): Omit<T, 'categoryId'> => {
  const copy: { -readonly [K in keyof T]?: T[K] } = { ...fields };
  delete copy.categoryId;
  return copy as Omit<T, 'categoryId'>;
};

const inputWith = (
  fields: Partial<Fields>,
  launchDate: string | null | undefined = VALID_INPUT.launchDate,
): ProductFormInput => ({
  fields: { ...VALID_INPUT.fields, ...fields },
  launchDate,
});

interface IssueSource {
  readonly success: boolean;
  readonly error?: {
    readonly issues: readonly {
      readonly message: string;
      readonly path: readonly PropertyKey[];
    }[];
  };
}

const issuesOf = (result: IssueSource) =>
  (result.error?.issues ?? []).map(({ message, path }) => ({
    path: path.join('.'),
    message,
  }));

const ALL_SCHEMAS = [
  ['登録', REGISTER_PRODUCT_FORM_SCHEMA],
  ['編集(ローンチ日あり)', EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate],
  ['編集(ローンチ日なし)', EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate],
] as const;

describe('文言(APIサーバーの入力の検証と同じ文言の固定値)', () => {
  test('入力の違反の文言を文言規則どおりの固定値で持つ', () => {
    expect(PRODUCT_FORM_MESSAGES).toEqual({
      handleUnavailable:
        'このハンドルは既に使われています。別の文字列を入力してください。',
      websiteUrlRequired: '外部WebサイトのURLを入力してください。',
      websiteUrlTooLong: '外部WebサイトURLは2,048文字以内で入力してください。',
      websiteUrlFormat:
        '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
      screenshotsTooMany:
        'スクリーンショットは20枚・合計10MB以内にしてください。',
      launchDateRequired: 'ローンチ日を選んでください。',
    });
    expect(CATEGORY_REQUIRED_MESSAGE).toBe('カテゴリを選択してください。');
    expect(LOGO_REQUIRED_MESSAGE).toBe('ロゴを選択してください。');
  });
});

describe.each(ALL_SCHEMAS)('%sのスキーマの共通の欄', (_label, schema) => {
  test('名称とタグラインと外部WebサイトURLの前後の空白を除き、説明文は値を変えずに通す', () => {
    const result = schema.parse(
      inputWith({
        name: '  Pitch Notes　',
        tagline: '\tピッチの台本を整える ',
        websiteUrl: ' https://pitch.example/ ',
        description: '  前後の空白を残す本文\n',
      }),
    );

    expect(result.fields).toMatchObject({
      name: 'Pitch Notes',
      tagline: 'ピッチの台本を整える',
      websiteUrl: 'https://pitch.example/',
      description: '  前後の空白を残す本文\n',
    });
  });

  test('名称は共用の入力規則の判定と文言で、禁止文字・未入力・文字数超過の順に最初の1つを示す', () => {
    const cases = [
      ['a\u0000'.repeat(PRODUCT_NAME_MAX_GRAPHEMES), 'forbidden-characters'],
      [' 　\t', 'empty'],
      ['あ'.repeat(PRODUCT_NAME_MAX_GRAPHEMES + 1), 'too-long'],
    ] as const;

    for (const [name, check] of cases) {
      expect(issuesOf(schema.safeParse(inputWith({ name })))).toEqual([
        { path: 'fields.name', message: PRODUCT_NAME_MESSAGES[check] ?? '' },
      ]);
    }
    expect(
      schema.safeParse(
        inputWith({ name: '👨‍👩‍👧'.repeat(PRODUCT_NAME_MAX_GRAPHEMES) }),
      ).success,
    ).toBe(true);
  });

  test('タグラインは共用の入力規則の判定と文言で、上限ちょうどを通し1つ超えると拒否する', () => {
    expect(
      schema.safeParse(
        inputWith({ tagline: 'あ'.repeat(PRODUCT_TAGLINE_MAX_GRAPHEMES) }),
      ).success,
    ).toBe(true);
    expect(
      issuesOf(
        schema.safeParse(
          inputWith({
            tagline: 'あ'.repeat(PRODUCT_TAGLINE_MAX_GRAPHEMES + 1),
          }),
        ),
      ),
    ).toEqual([
      {
        path: 'fields.tagline',
        message: PRODUCT_TAGLINE_MESSAGES['too-long'] ?? '',
      },
    ]);
    expect(issuesOf(schema.safeParse(inputWith({ tagline: '' })))).toEqual([
      {
        path: 'fields.tagline',
        message: 'タグラインを入力してください。',
      },
    ]);
  });

  test('ハンドルはプロダクトのハンドルの規則と文言で検証する', () => {
    expect(issuesOf(schema.safeParse(inputWith({ handle: '' })))).toEqual([
      { path: 'fields.handle', message: PRODUCT_HANDLE_MESSAGES.empty ?? '' },
    ]);
    expect(
      issuesOf(schema.safeParse(inputWith({ handle: 'a'.repeat(51) }))),
    ).toEqual([
      {
        path: 'fields.handle',
        message: 'ハンドルは50文字以内で入力してください。',
      },
    ]);
    expect(issuesOf(schema.safeParse(inputWith({ handle: '-pitch' })))).toEqual(
      [
        {
          path: 'fields.handle',
          message: PRODUCT_HANDLE_MESSAGES['invalid-characters'] ?? '',
        },
      ],
    );
    expect(
      schema.safeParse(inputWith({ handle: 'a'.repeat(50) })).success,
    ).toBe(true);
  });

  test('外部WebサイトURLは未入力・文字数超過・形式違反の順に最初の1つを示す', () => {
    const tooLong = `https://pitch.example/${'a'.repeat(EXTERNAL_URL_MAX_LENGTH)}`;
    const cases = [
      ['  ', PRODUCT_FORM_MESSAGES.websiteUrlRequired],
      [tooLong, PRODUCT_FORM_MESSAGES.websiteUrlTooLong],
      ['/relative/path', PRODUCT_FORM_MESSAGES.websiteUrlFormat],
      ['javascript:alert(1)', PRODUCT_FORM_MESSAGES.websiteUrlFormat],
      ['ftp://pitch.example/', PRODUCT_FORM_MESSAGES.websiteUrlFormat],
    ] as const;

    for (const [websiteUrl, message] of cases) {
      expect(issuesOf(schema.safeParse(inputWith({ websiteUrl })))).toEqual([
        { path: 'fields.websiteUrl', message },
      ]);
    }
    expect(
      schema.safeParse(inputWith({ websiteUrl: 'http://pitch.example' }))
        .success,
    ).toBe(true);
  });

  test('説明文は共用のマークダウンの規則で、必須・上限20,000文字・禁止文字を検証する', () => {
    const cases = [
      [' \n\t', '説明文を入力してください。'],
      [
        'あ'.repeat(PRODUCT_DESCRIPTION_MAX_GRAPHEMES + 1),
        '説明文は20,000文字以内で入力してください。',
      ],
      ['本文\u0007', '説明文に使用できない文字が含まれています。'],
    ] as const;

    for (const [description, message] of cases) {
      expect(issuesOf(schema.safeParse(inputWith({ description })))).toEqual([
        { path: 'fields.description', message },
      ]);
    }
    expect(
      schema.safeParse(
        inputWith({
          description: 'あ'.repeat(PRODUCT_DESCRIPTION_MAX_GRAPHEMES),
        }),
      ).success,
    ).toBe(true);
  });

  test('ロゴが未設定なら拒否する', () => {
    expect(issuesOf(schema.safeParse(inputWith({ logoFileId: null })))).toEqual(
      [{ path: 'fields.logoFileId', message: LOGO_REQUIRED_MESSAGE }],
    );
  });

  test('スクリーンショットは0枚と上限の20枚を通し、21枚を拒否する', () => {
    const idsOf = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `01JD0FILE${String(index).padStart(17, '0')}`,
      );

    expect(schema.safeParse(inputWith({ screenshotFileIds: [] })).success).toBe(
      true,
    );
    expect(
      schema.safeParse(
        inputWith({ screenshotFileIds: idsOf(PRODUCT_SCREENSHOTS_MAX) }),
      ).success,
    ).toBe(true);
    expect(
      issuesOf(
        schema.safeParse(
          inputWith({ screenshotFileIds: idsOf(PRODUCT_SCREENSHOTS_MAX + 1) }),
        ),
      ),
    ).toEqual([
      {
        path: 'fields.screenshotFileIds',
        message: PRODUCT_FORM_MESSAGES.screenshotsTooMany,
      },
    ]);
  });
});

describe('登録のスキーマ', () => {
  test('全欄が正しい入力を、RegisterProductInputと同じ形の値にして通す', () => {
    expect(REGISTER_PRODUCT_FORM_SCHEMA.parse(VALID_INPUT)).toEqual({
      fields: VALID_FIELDS,
      launchDate: '2026-11-20',
    });
  });

  test('カテゴリとローンチ日を必須にする', () => {
    expect(
      issuesOf(
        REGISTER_PRODUCT_FORM_SCHEMA.safeParse(
          inputWith({ categoryId: '' }, null),
        ),
      ),
    ).toEqual([
      { path: 'fields.categoryId', message: CATEGORY_REQUIRED_MESSAGE },
      { path: 'launchDate', message: PRODUCT_FORM_MESSAGES.launchDateRequired },
    ]);
  });

  test('カテゴリの無い値を拒否する', () => {
    const fields = withoutCategory(VALID_INPUT.fields);

    expect(
      REGISTER_PRODUCT_FORM_SCHEMA.safeParse({ ...VALID_INPUT, fields })
        .success,
    ).toBe(false);
  });
});

describe('編集のスキーマ', () => {
  test.each([
    EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate,
    EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate,
  ])('カテゴリの無い値(無効にした欄)を通す', (schema) => {
    const fields = withoutCategory(VALID_INPUT.fields);

    const result = schema.parse({ ...VALID_INPUT, fields });

    expect(result.fields).not.toHaveProperty('categoryId');
    expect(result.fields.name).toBe('Pitch Notes');
  });

  test('ローンチ日を含むスキーマは、未選択(次回のローンチを予約しない)をnullとして通す', () => {
    expect(
      EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate.parse(inputWith({}, null)),
    ).toEqual({ fields: VALID_FIELDS, launchDate: null });
    expect(
      EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate.parse(VALID_INPUT).launchDate,
    ).toBe('2026-11-20');
  });

  test('ローンチ日を含まないスキーマは、ローンチ日を出力に含めない', () => {
    const result = EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate.parse(
      inputWith({}, '2026-11-20'),
    );

    expect(result).toEqual({ fields: VALID_FIELDS });
  });

  test('カテゴリを選び直した値は空を拒否する', () => {
    expect(
      issuesOf(
        EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate.safeParse(
          inputWith({ categoryId: '' }),
        ),
      ),
    ).toEqual([
      { path: 'fields.categoryId', message: CATEGORY_REQUIRED_MESSAGE },
    ]);
  });
});

describe('editProductFormSchemaOf', () => {
  const PLAN: LaunchPlanView = {
    mode: 'reschedule',
    currentLaunchDate: '2026-11-20',
    window: {
      earliest: '2026-11-11',
      latest: '2027-02-07',
      unavailable: [],
      relaunchIntervalDays: null,
    },
    blocks: [],
    locked: false,
    locks: [],
    lockUnknown: false,
    ultrasEntitled: false,
  };

  test('カレンダーを描く計画(変更・予約)では、ローンチ日を含むスキーマを選ぶ', () => {
    expect(editProductFormSchemaOf(PLAN)).toBe(
      EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate,
    );
    expect(
      editProductFormSchemaOf({
        ...PLAN,
        mode: 'new',
        currentLaunchDate: null,
      }),
    ).toBe(EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate);
  });

  test.each<Partial<LaunchPlanView>>([
    { locked: true },
    { lockUnknown: true },
    { mode: 'blocked', window: null },
    { mode: 'unknown', window: null },
  ])(
    'カレンダーを描かない計画(%o)では、ローンチ日を含まないスキーマを選ぶ',
    (overrides) => {
      expect(editProductFormSchemaOf({ ...PLAN, ...overrides })).toBe(
        EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate,
      );
    },
  );
});
