import { describe, expect, test } from 'bun:test';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  checkHandleFormat,
  IMPERSONATION_RESERVED_HANDLES,
} from '../../../common-lib/handles/handle-rules.ts';
import {
  checkHelpSubtitle,
  checkHelpTitle,
  HELP_ARTICLE_HANDLE_RULE,
  HELP_BODY_MAX,
  HELP_BODY_RULE,
  HELP_SUBTITLE_MAX,
  HELP_TITLE_MAX,
} from '../../../common-lib/help/help-input-rules.ts';
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import {
  HELP_ARTICLE_FORM_SCHEMA,
  type HelpArticleFormInput,
} from './help-article-form-schema.ts';
import {
  HELP_CATEGORY_REQUIRED_MESSAGE,
  HELP_HANDLE_MESSAGES,
  HELP_SUBTITLE_MESSAGES,
  HELP_TITLE_MESSAGES,
} from './help-messages.ts';

const VALID_INPUT: HelpArticleFormInput = Object.freeze({
  fields: Object.freeze({
    title: 'Upvoteの仕組み',
    subtitle: '投票の数え方と締め切り',
    handle: 'How-Upvote_Works',
    categoryId: '01JD0HCAT00000000000000001',
    pinned: true,
    status: 'published',
    body: '## 数え方\n\n1人1票です。\n',
  }),
  reason: '',
});

const inputWith = (
  fields: Partial<HelpArticleFormInput['fields']>,
  reason: string = VALID_INPUT.reason,
): HelpArticleFormInput => ({
  fields: { ...VALID_INPUT.fields, ...fields },
  reason,
});

interface IssueSource {
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

const issuesFor = (input: HelpArticleFormInput) =>
  issuesOf(HELP_ARTICLE_FORM_SCHEMA.safeParse(input));

describe('入力の形', () => {
  test('全欄が正しい入力を、CreateHelpArticleInput・UpdateHelpArticleInputと同じくfieldsの下と外の理由に分けて通し、空の理由はundefinedにする', () => {
    expect(HELP_ARTICLE_FORM_SCHEMA.parse(VALID_INPUT)).toEqual({
      fields: { ...VALID_INPUT.fields },
      reason: undefined,
    });
  });

  test('タイトル・サブタイトル・理由は前後の空白を除き、ハンドルの表記と本文は値を変えずに通す', () => {
    const result = HELP_ARTICLE_FORM_SCHEMA.parse(
      inputWith(
        {
          title: '  Upvoteの仕組み　',
          subtitle: '\t投票の数え方 ',
          body: '  前後の空白を残す本文\n',
        },
        ' 誤字の修正 ',
      ),
    );

    expect(result.fields.title).toBe('Upvoteの仕組み');
    expect(result.fields.subtitle).toBe('投票の数え方');
    expect(result.fields.handle).toBe('How-Upvote_Works');
    expect(result.fields.body).toBe('  前後の空白を残す本文\n');
    expect(result.reason).toBe('誤字の修正');
  });
});

describe.each([
  ['title', checkHelpTitle, HELP_TITLE_MAX, HELP_TITLE_MESSAGES, 'タイトル'],
  [
    'subtitle',
    checkHelpSubtitle,
    HELP_SUBTITLE_MAX,
    HELP_SUBTITLE_MESSAGES,
    'サブタイトル',
  ],
] as const)('%sの欄', (field, check, max, messages, label) => {
  test('文言はAPIサーバーと同じく項目名と入力規則の上限から組み立てる', () => {
    expect(messages).toEqual({
      'forbidden-characters': `${label}に使用できない文字が含まれています。`,
      empty: `${label}を入力してください。`,
      'too-long': `${label}は${String(max)}文字以内で入力してください。`,
    });
  });

  test.each([
    ['a\u0000', 'forbidden-characters'],
    [' 　\t', 'empty'],
    ['あ'.repeat(max + 1), 'too-long'],
  ] as const)(
    '共用の判定が%jを%sとする入力は、その違反の文言だけを示す',
    (value, expected) => {
      expect(check(value)).toBe(expected);
      expect(issuesFor(inputWith({ [field]: value }))).toEqual([
        { path: `fields.${field}`, message: messages[expected] },
      ]);
    },
  );

  test('上限ちょうどの書記素(前後の空白を除いた数)は通す', () => {
    const value = ` ${'👨‍👩‍👧'.repeat(max)} `;
    expect(check(value)).toBeUndefined();
    expect(
      HELP_ARTICLE_FORM_SCHEMA.safeParse(inputWith({ [field]: value })).success,
    ).toBe(true);
  });
});

describe('ハンドルの欄', () => {
  test('文言はAPIサーバーと同じく、ヘルプ記事のハンドルの規則の上限から組み立てる', () => {
    expect(HELP_HANDLE_MESSAGES).toEqual({
      ok: undefined,
      empty: 'ハンドルを入力してください。',
      'too-long': `ハンドルは${String(HELP_ARTICLE_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
      'invalid-characters':
        'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    });
  });

  test.each([
    ['', 'empty'],
    ['a'.repeat(HELP_ARTICLE_HANDLE_RULE.maxLength + 1), 'too-long'],
    ['-upvote', 'invalid-characters'],
    ['up vote', 'invalid-characters'],
  ] as const)(
    '共用の判定が%jを%sとする入力は、その違反の文言だけを示す',
    (handle, expected) => {
      expect(checkHandleFormat(handle, HELP_ARTICLE_HANDLE_RULE)).toBe(
        expected,
      );
      expect(issuesFor(inputWith({ handle }))).toEqual([
        {
          path: 'fields.handle',
          message: HELP_HANDLE_MESSAGES[expected] ?? '',
        },
      ]);
    },
  );

  test('上限ちょうどと、ユーザー・プロダクトの予約語を受け付ける', () => {
    const handles = [
      'a'.repeat(HELP_ARTICLE_HANDLE_RULE.maxLength),
      ...IMPERSONATION_RESERVED_HANDLES,
      'Support',
    ];

    for (const handle of handles) {
      expect(
        HELP_ARTICLE_FORM_SCHEMA.safeParse(inputWith({ handle })).success,
      ).toBe(true);
    }
  });
});

describe('カテゴリ・ピン留め・ステータスの欄', () => {
  test('カテゴリの未選択は、APIサーバーのカテゴリの不在と同じ文言で拒否する', () => {
    expect(HELP_CATEGORY_REQUIRED_MESSAGE).toBe('カテゴリを選択してください。');
    expect(issuesFor(inputWith({ categoryId: '' }))).toEqual([
      { path: 'fields.categoryId', message: HELP_CATEGORY_REQUIRED_MESSAGE },
    ]);
  });

  test('ピン留めの有無と、下書き・公開のステータスを通す', () => {
    expect(
      HELP_ARTICLE_FORM_SCHEMA.parse(
        inputWith({ pinned: false, status: 'draft' }),
      ).fields,
    ).toMatchObject({ pinned: false, status: 'draft' });
  });
});

describe('本文の欄', () => {
  const BODY_RULE = markdownTextSchema(HELP_BODY_RULE);

  test.each([
    [' \n\t', '本文を入力してください。'],
    [
      'あ'.repeat(HELP_BODY_MAX + 1),
      '本文は100,000文字以内で入力してください。',
    ],
    ['本文\u0007', '本文に使用できない文字が含まれています。'],
  ])(
    '共用のマークダウンの規則(本文・100,000文字・必須)と同じ文言%#で拒否する',
    (body, message) => {
      expect(BODY_RULE.safeParse(body).error?.issues[0]?.message).toBe(message);
      expect(issuesFor(inputWith({ body }))).toEqual([
        { path: 'fields.body', message },
      ]);
    },
  );

  test('上限ちょうどを通す', () => {
    expect(
      HELP_ARTICLE_FORM_SCHEMA.safeParse(
        inputWith({ body: 'あ'.repeat(HELP_BODY_MAX) }),
      ).success,
    ).toBe(true);
  });
});

describe('理由の欄', () => {
  test('監査ログの理由の上限ちょうどを通し、超えると拒否する', () => {
    expect(
      HELP_ARTICLE_FORM_SCHEMA.safeParse(
        inputWith({}, 'あ'.repeat(AUDIT_REASON_MAX)),
      ).success,
    ).toBe(true);
    expect(issuesFor(inputWith({}, 'あ'.repeat(AUDIT_REASON_MAX + 1)))).toEqual(
      [
        {
          path: 'reason',
          message: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
        },
      ],
    );
  });
});
