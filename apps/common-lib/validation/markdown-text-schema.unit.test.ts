import { describe, expect, test } from 'bun:test';

import { markdownTextSchema } from './markdown-text-schema.ts';

const issueMessagesOf = (
  result: ReturnType<ReturnType<typeof markdownTextSchema>['safeParse']>,
): readonly string[] =>
  result.success ? [] : result.error.issues.map(({ message }) => message);

const commentSchema = markdownTextSchema({
  label: 'コメント',
  maxGraphemes: 5,
  required: true,
});

const optionalSchema = markdownTextSchema({
  label: '補足',
  maxGraphemes: 5,
  required: false,
});

describe('markdownTextSchema', () => {
  describe('上限の書記素の数', () => {
    test.each([
      ['上限ちょうどの文字列', 'あいうえお'],
      ['結合した絵文字を含む上限ちょうどの文字列', '👨‍👩‍👧‍👦🇯🇵éがお'],
    ])('%sを受け付ける', (_, text) => {
      expect(commentSchema.safeParse(text).success).toBe(true);
    });

    test('上限を1文字超えた場合に上限の文言で失敗させる', () => {
      expect(issueMessagesOf(commentSchema.safeParse('あいうえおか'))).toEqual([
        'コメントは5文字以内で入力してください。',
      ]);
    });

    test('上限を3桁区切りで文言に入れる', () => {
      const schema = markdownTextSchema({
        label: '説明',
        maxGraphemes: 10000,
        required: true,
      });

      expect(issueMessagesOf(schema.safeParse('a'.repeat(10001)))).toEqual([
        '説明は10,000文字以内で入力してください。',
      ]);
    });

    test('3桁に満たない上限を区切らずに文言に入れる', () => {
      const schema = markdownTextSchema({
        label: 'タグライン',
        maxGraphemes: 999,
        required: true,
      });

      expect(issueMessagesOf(schema.safeParse('a'.repeat(1000)))).toEqual([
        'タグラインは999文字以内で入力してください。',
      ]);
    });

    test('7桁の上限を2箇所で区切って文言に入れる', () => {
      const schema = markdownTextSchema({
        label: '本文',
        maxGraphemes: 1000000,
        required: true,
      });

      expect(issueMessagesOf(schema.safeParse('a'.repeat(1000001)))).toEqual([
        '本文は1,000,000文字以内で入力してください。',
      ]);
    });

    test('任意の項目でも上限を超えた場合に上限の文言で失敗させる', () => {
      expect(issueMessagesOf(optionalSchema.safeParse('あいうえおか'))).toEqual(
        ['補足は5文字以内で入力してください。'],
      );
    });
  });

  describe('必須の項目', () => {
    test.each([
      ['空文字列', ''],
      ['半角空白だけ', '   '],
      ['全角空白だけ', '　　'],
      ['タブと改行だけ', '\t\r\n\n'],
    ])('%sの場合に必須の文言で失敗させる', (_, text) => {
      expect(issueMessagesOf(commentSchema.safeParse(text))).toEqual([
        'コメントを入力してください。',
      ]);
    });

    test('上限を超える空白だけの文字列も必須の文言だけで失敗させる', () => {
      expect(issueMessagesOf(commentSchema.safeParse(' '.repeat(6)))).toEqual([
        'コメントを入力してください。',
      ]);
    });

    test.each([
      ['空文字列', ''],
      ['空白だけ', ' 　\n'],
    ])('任意の項目では%sを受け付ける', (_, text) => {
      expect(optionalSchema.safeParse(text)).toEqual({
        success: true,
        data: text,
      });
    });
  });

  describe('使用できない文字', () => {
    test.each([
      ['孤立したサロゲート', 'あ\ud83dい'],
      ['NUL', 'あ\u0000い'],
      ['ESC', 'あ\u001bい'],
      ['DEL', 'あ\u007fい'],
    ])('%sを含む場合に禁止文字の文言で失敗させる', (_, text) => {
      expect(issueMessagesOf(commentSchema.safeParse(text))).toEqual([
        'コメントに使用できない文字が含まれています。',
      ]);
    });

    test('禁止文字を含み上限も超える場合は禁止文字の文言だけで失敗させる', () => {
      expect(
        issueMessagesOf(commentSchema.safeParse('あいうえおか\u0000')),
      ).toEqual(['コメントに使用できない文字が含まれています。']);
    });

    test.each([
      ['VTだけ', '\u000b'],
      ['FFだけ', '\f'],
      ['半角空白とVTだけ', ' \u000b '],
    ])(
      '空白とみなされる禁止文字の%sの場合は必須の項目でも禁止文字の文言だけで失敗させる',
      (_, text) => {
        expect(text.trim()).toBe('');
        expect(issueMessagesOf(commentSchema.safeParse(text))).toEqual([
          'コメントに使用できない文字が含まれています。',
        ]);
      },
    );

    test('任意の項目でも禁止文字を含む場合に禁止文字の文言で失敗させる', () => {
      expect(issueMessagesOf(optionalSchema.safeParse('\u0001'))).toEqual([
        '補足に使用できない文字が含まれています。',
      ]);
    });

    test('タブ・改行・CRを使用できる文字として受け付ける', () => {
      expect(commentSchema.safeParse('a\tb\r\nc').success).toBe(true);
    });
  });

  describe('マークダウンの構文', () => {
    const bodySchema = markdownTextSchema({
      label: '本文',
      maxGraphemes: 1000,
      required: true,
    });

    test.each([
      ['見出しレベル1', '# 見出し'],
      ['画像', '![代替テキスト](https://images.example/a.png)'],
      ['Raw HTML', '<script>alert(1)</script><div onclick="x">本文</div>'],
      [
        '見出しレベル1・画像・Raw HTMLの混在',
        '# 見出し\n\n![画像](https://images.example/b.png)\n\n<iframe src="https://site.example"></iframe>',
      ],
    ])('%sを含むことを理由に失敗させない', (_, text) => {
      expect(bodySchema.safeParse(text).success).toBe(true);
    });
  });

  describe('値の扱い', () => {
    test.each([
      ['前後の空白と改行', '  本文\r\n\n'],
      ['NFKC正規化の対象の文字', 'ｶﾞｷﾞ①ＡＢＣ'],
      ['結合文字', 'がé'],
      ['マークダウンの記法', '**強調**と<br>'],
    ])('%sを変換せずにそのまま返す', (_, text) => {
      const schema = markdownTextSchema({
        label: '本文',
        maxGraphemes: 100,
        required: true,
      });

      expect(schema.safeParse(text)).toEqual({ success: true, data: text });
    });

    test.each([
      ['数値', 1],
      ['null', null],
      ['undefined', undefined],
      ['配列', ['本文']],
    ])('文字列でない%sをZodの既定の失敗にする', (_, value) => {
      const result = commentSchema.safeParse(value);

      expect(result.success).toBe(false);
      expect(result.error?.issues.map(({ code }) => code)).toEqual([
        'invalid_type',
      ]);
    });
  });

  describe('上限の引数の検証', () => {
    test.each([
      ['0', 0],
      ['負の数', -1],
      ['小数', 1.5],
      ['NaN', Number.NaN],
      ['無限大', Number.POSITIVE_INFINITY],
    ])('上限が%sの場合に例外を投げる', (_, maxGraphemes) => {
      expect(() =>
        markdownTextSchema({ label: 'コメント', maxGraphemes, required: true }),
      ).toThrow(RangeError);
    });

    test('上限が1の場合に1文字を受け付けて2文字で失敗させる', () => {
      const schema = markdownTextSchema({
        label: '記号',
        maxGraphemes: 1,
        required: true,
      });

      expect(schema.safeParse('🇯🇵').success).toBe(true);
      expect(issueMessagesOf(schema.safeParse('🇯🇵🇺🇸'))).toEqual([
        '記号は1文字以内で入力してください。',
      ]);
    });
  });
});
