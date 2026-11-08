import { describe, expect, test } from 'bun:test';

import { PROFILE_FORM_MESSAGES } from './profile-form-messages.ts';
import {
  PROFILE_FORM_SCHEMA,
  type ProfileFormInput,
} from './profile-form-schema.ts';

const VALID_INPUT: ProfileFormInput = Object.freeze({
  nickname: 'ピッチの作り手',
  handle: 'maker_ai',
  headline: '',
  bio: '',
  avatarFileId: null,
  websites: [],
});

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

const inputWith = (overrides: Partial<ProfileFormInput>): ProfileFormInput => ({
  ...VALID_INPUT,
  ...overrides,
});

describe('文言(APIサーバーの入力の検証と同じ文言の固定値)', () => {
  test('入力の違反の文言を文言規則どおりの固定値で持つ', () => {
    expect(PROFILE_FORM_MESSAGES).toEqual({
      nicknameRequired: 'ニックネームを入力してください。',
      nicknameTooLong: 'ニックネームは25文字以内で入力してください。',
      handleRequired: 'ハンドルを入力してください。',
      handleTooLong: 'ハンドルは25文字以内で入力してください。',
      handleFormat:
        'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
      handleUnavailable:
        'このハンドルは既に使われています。別の文字列を入力してください。',
      headlineForbiddenCharacters:
        'ヘッドラインに使用できない文字が含まれています。',
      headlineTooLong: 'ヘッドラインは50文字以内で入力してください。',
      websitesTooMany: '外部Webサイトは10件以内で入力してください。',
      websiteNameForbiddenCharacters:
        '外部Webサイトの名前に使用できない文字が含まれています。',
      websiteNameTooLong: '外部Webサイトの名前は25文字以内で入力してください。',
      websiteUrlRequired: '外部WebサイトのURLを入力してください。',
      websiteUrlTooLong: '外部WebサイトURLは2,048文字以内で入力してください。',
      websiteUrlFormat:
        '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
    });
  });
});

describe('PROFILE_FORM_SCHEMA', () => {
  test('全欄が正しい入力を、未入力の任意項目をnullにして通す', () => {
    const result = PROFILE_FORM_SCHEMA.parse(VALID_INPUT);

    expect(result).toEqual({
      nickname: 'ピッチの作り手',
      handle: 'maker_ai',
      headline: null,
      bio: null,
      avatarFileId: null,
      websites: [],
    });
  });

  test('ニックネームと任意の行の前後の空白を除き、ハンドルと自己紹介は値を変えない', () => {
    const result = PROFILE_FORM_SCHEMA.parse(
      inputWith({
        nickname: '  　作り手 ',
        handle: 'Maker-AI',
        headline: ' 開発者　',
        bio: '  **太字**\n',
        avatarFileId: '01JC0FILE00000000000000001',
        websites: [{ name: ' 個人サイト ', url: ' https://maker.example/ ' }],
      }),
    );

    expect(result).toEqual({
      nickname: '作り手',
      handle: 'Maker-AI',
      headline: '開発者',
      bio: '  **太字**\n',
      avatarFileId: '01JC0FILE00000000000000001',
      websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
    });
  });

  test('空白だけの自己紹介と名前は未設定として扱う', () => {
    const result = PROFILE_FORM_SCHEMA.parse(
      inputWith({
        bio: ' \n　',
        websites: [{ name: '　', url: 'https://maker.example/' }],
      }),
    );

    expect(result.bio).toBeNull();
    expect(result.websites).toEqual([
      { name: null, url: 'https://maker.example/' },
    ]);
  });

  test.each([
    ['空のニックネーム', { nickname: ' 　' }, 'nicknameRequired'],
    ['26文字のニックネーム', { nickname: 'あ'.repeat(26) }, 'nicknameTooLong'],
    ['空のハンドル', { handle: '' }, 'handleRequired'],
    ['26文字のハンドル', { handle: 'a'.repeat(26) }, 'handleTooLong'],
    ['記号で始まるハンドル', { handle: '_maker' }, 'handleFormat'],
    ['空白を含むハンドル', { handle: 'maker ai' }, 'handleFormat'],
    ['全角のハンドル', { handle: 'ｍａｋｅｒ' }, 'handleFormat'],
    [
      '使用できない文字を含むヘッドライン',
      { headline: '開発者\u0007' },
      'headlineForbiddenCharacters',
    ],
    ['51文字のヘッドライン', { headline: 'あ'.repeat(51) }, 'headlineTooLong'],
    [
      '使用できない文字だけが端にあるヘッドライン',
      { headline: '\u0085開発者' },
      'headlineForbiddenCharacters',
    ],
  ] as const)('%sは文言規則の文言で拒否する', (_name, overrides, key) => {
    const result = PROFILE_FORM_SCHEMA.safeParse(inputWith(overrides));

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toEqual([PROFILE_FORM_MESSAGES[key]]);
  });

  test('前後の空白を除いて50文字のヘッドラインは通し、ハンドルは25文字ちょうどを通す', () => {
    const result = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ headline: ` ${'あ'.repeat(50)} `, handle: 'a'.repeat(25) }),
    );

    expect(result.success).toBe(true);
  });

  test.each([
    ['空のURL', '', 'websiteUrlRequired'],
    ['空白だけのURL', '  ', 'websiteUrlRequired'],
    [
      '2,049文字のURL',
      `https://maker.example/${'a'.repeat(2027)}`,
      'websiteUrlTooLong',
    ],
    ['スキームの無いURL', 'maker.example', 'websiteUrlFormat'],
    [
      'httpsでもhttpでもないスキームのURL',
      'ftp://maker.example',
      'websiteUrlFormat',
    ],
    ['javascriptスキームのURL', 'javascript:alert(1)', 'websiteUrlFormat'],
    ['スキームの直後に//の無いURL', 'https:maker.example', 'websiteUrlFormat'],
  ] as const)('外部Webサイトの%sを拒否する', (_name, url, key) => {
    const result = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ websites: [{ name: '', url }] }),
    );

    expect(messagesOf(result)).toEqual([PROFILE_FORM_MESSAGES[key]]);
  });

  test.each([
    [
      '使用できない文字を含む名前',
      'サイト\u0001',
      'websiteNameForbiddenCharacters',
    ],
    ['26文字の名前', 'あ'.repeat(26), 'websiteNameTooLong'],
  ] as const)('外部Webサイトの%sを拒否する', (_name, name, key) => {
    const result = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ websites: [{ name, url: 'https://maker.example/' }] }),
    );

    expect(messagesOf(result)).toEqual([PROFILE_FORM_MESSAGES[key]]);
  });

  test('外部Webサイトを10件まで通し、11件を拒否する', () => {
    const rowOf = (index: number) => ({
      name: '',
      url: `https://maker${String(index)}.example/`,
    });

    const ten = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ websites: Array.from({ length: 10 }, (_, i) => rowOf(i)) }),
    );
    const eleven = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ websites: Array.from({ length: 11 }, (_, i) => rowOf(i)) }),
    );

    expect(ten.success).toBe(true);
    expect(messagesOf(eleven)).toEqual([PROFILE_FORM_MESSAGES.websitesTooMany]);
  });

  test('自己紹介の違反をマークダウンの入力欄の規則の文言で拒否する', () => {
    const forbidden = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ bio: '自己紹介\u0000' }),
    );
    const tooLong = PROFILE_FORM_SCHEMA.safeParse(
      inputWith({ bio: 'あ'.repeat(5001) }),
    );

    expect(messagesOf(forbidden)).toEqual([
      '自己紹介に使用できない文字が含まれています。',
    ]);
    expect(messagesOf(tooLong)).toEqual([
      '自己紹介は5,000文字以内で入力してください。',
    ]);
  });
});
