import { describe, expect, test } from 'bun:test';

import {
  MY_PROFILE_PATCH_MESSAGES,
  MyProfilePatchSchema,
  PROFILE_FIELD_MESSAGES,
} from './profiles.ts';

interface Issue {
  readonly field: string;
  readonly message: string;
}

function issuesOf(body: unknown): Issue[] {
  const result = MyProfilePatchSchema.safeParse(body);
  if (result.success) {
    throw new Error('検証に通ってしまいました');
  }
  return result.error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

describe('MyProfilePatchSchema', () => {
  test('GraphQLの保存と同じく、ニックネーム・ヘッドライン・Webサイトの前後の空白を除き、空のヘッドライン・Webサイトの名前・自己紹介をnullにし、ハンドルと自己紹介は値を変えない', () => {
    expect(
      MyProfilePatchSchema.parse({
        nickname: '  新しいアリス  ',
        handle: 'Alice-New',
        headline: '  個人開発者  ',
        bio_markdown: '  **自己紹介**\n',
        websites: [
          { name: '  GitHub ', url: ' https://github.example/alice ' },
          { name: '   ', url: 'http://blog.example/' },
          { name: null, url: 'https://third.example/' },
          { url: 'https://fourth.example/' },
        ],
      }),
    ).toEqual({
      nickname: '新しいアリス',
      handle: 'Alice-New',
      headline: '個人開発者',
      bio_markdown: '  **自己紹介**\n',
      websites: [
        { name: 'GitHub', url: 'https://github.example/alice' },
        { name: null, url: 'http://blog.example/' },
        { name: null, url: 'https://third.example/' },
        { name: null, url: 'https://fourth.example/' },
      ],
    });
  });

  test('空・空白だけのヘッドラインと自己紹介とnullはnullにする', () => {
    expect(
      MyProfilePatchSchema.parse({ headline: ' \t', bio_markdown: ' \n ' }),
    ).toEqual({ headline: null, bio_markdown: null });
    expect(
      MyProfilePatchSchema.parse({ headline: null, bio_markdown: null }),
    ).toEqual({ headline: null, bio_markdown: null });
  });

  test('指定の無い項目は出力に含めない', () => {
    expect(MyProfilePatchSchema.parse({ websites: [] })).toEqual({
      websites: [],
    });
  });

  test.each([
    [
      'ニックネームの空白だけ',
      { nickname: ' 　' },
      'nickname',
      'nicknameRequired',
    ],
    [
      'ニックネームの26文字',
      { nickname: 'あ'.repeat(26) },
      'nickname',
      'nicknameTooLong',
    ],
    ['ハンドルの空', { handle: '' }, 'handle', 'handleRequired'],
    ['ハンドルの26文字', { handle: 'a'.repeat(26) }, 'handle', 'handleTooLong'],
    ['ハンドルの前後の空白', { handle: ' alice ' }, 'handle', 'handleFormat'],
    [
      'ヘッドラインの51文字',
      { headline: 'あ'.repeat(51) },
      'headline',
      'headlineTooLong',
    ],
    [
      'ヘッドラインの制御文字',
      { headline: 'a\u0000b' },
      'headline',
      'headlineForbiddenCharacters',
    ],
    [
      'Webサイトの11件',
      {
        websites: Array.from({ length: 11 }, (_, index) => ({
          url: `https://site${String(index)}.example/`,
        })),
      },
      'websites',
      'websitesTooMany',
    ],
    [
      'Webサイトの名前の26文字',
      { websites: [{ name: 'あ'.repeat(26), url: 'https://a.example/' }] },
      'websites.0.name',
      'websiteNameTooLong',
    ],
    [
      'WebサイトのURLの空白だけ',
      { websites: [{ url: '  ' }] },
      'websites.0.url',
      'websiteUrlRequired',
    ],
    [
      'WebサイトのURLのjavascriptスキーム',
      { websites: [{ url: 'javascript:alert(1)' }] },
      'websites.0.url',
      'websiteUrlFormat',
    ],
  ] as const)(
    '%sは画面と同じ文言で拒否する',
    (_name, body, field, messageKey) => {
      expect(issuesOf(body)).toEqual([
        { field, message: PROFILE_FIELD_MESSAGES[messageKey] },
      ]);
    },
  );

  test('自己紹介の5,001文字と制御文字はマークダウンの入力欄と同じ文言で拒否する', () => {
    expect(issuesOf({ bio_markdown: 'あ'.repeat(5001) })).toEqual([
      {
        field: 'bio_markdown',
        message: '自己紹介は5,000文字以内で入力してください。',
      },
    ]);
    expect(issuesOf({ bio_markdown: 'a\u0007b' })).toEqual([
      {
        field: 'bio_markdown',
        message: '自己紹介に使用できない文字が含まれています。',
      },
    ]);
  });

  test('項目の無い本文は拒否する', () => {
    expect(issuesOf({})).toEqual([
      { field: '', message: MY_PROFILE_PATCH_MESSAGES.noFields },
    ]);
  });

  test.each([
    ['プロフィール画像', { avatar: null }],
    ['画像のID', { nickname: 'アリス', avatar_file_id: 'x' }],
    ['未知の項目', { previous_handle: 'alice' }],
  ])('%sを含む本文は更新できない項目として拒否する', (_name, body) => {
    expect(issuesOf(body)).toEqual([
      { field: '', message: MY_PROFILE_PATCH_MESSAGES.unknownFields },
    ]);
  });

  test('Webサイトの未知の項目も拒否する', () => {
    expect(
      issuesOf({ websites: [{ url: 'https://a.example/', title: 'x' }] }),
    ).toEqual([
      { field: 'websites.0', message: MY_PROFILE_PATCH_MESSAGES.unknownFields },
    ]);
  });

  test.each([
    ['ニックネームのnull', { nickname: null }, 'nickname'],
    ['ハンドルの数値', { handle: 1 }, 'handle'],
    ['ヘッドラインの真偽値', { headline: true }, 'headline'],
    ['自己紹介の配列', { bio_markdown: ['a'] }, 'bio_markdown'],
    ['Webサイトのnull', { websites: null }, 'websites'],
    ['WebサイトのURLの数値', { websites: [{ url: 1 }] }, 'websites.0.url'],
  ])('%sは型の誤りとして拒否する', (_name, body, field) => {
    expect(issuesOf(body)).toEqual([
      { field, message: MY_PROFILE_PATCH_MESSAGES.invalidType },
    ]);
  });

  test.each([
    ['null', null],
    ['配列', []],
    ['文字列', 'nickname'],
  ])('本文が%sなら型の誤りとして拒否する', (_name, body) => {
    expect(issuesOf(body)).toEqual([
      { field: '', message: MY_PROFILE_PATCH_MESSAGES.invalidType },
    ]);
  });
});
