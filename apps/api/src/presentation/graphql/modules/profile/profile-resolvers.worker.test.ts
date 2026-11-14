import { describe, expect, test } from 'vitest';

import { USER_AVATAR_PURPOSE } from '../../../../../common-lib/profile/profile-input-rules.ts';
import { userFollows } from '../../../../../db/schema/follow/user-follows.ts';
import { users } from '../../../../../db/schema/identity/users.ts';
import { insertPreviousHandle } from '../../../../../lib/workers/handles/testing/handle-fixtures.ts';
import {
  after,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
  fetchHandleAvailability,
  fetchMyProfile,
  fetchPublicProfile,
  installProfileGraphQLTest,
  issueUserSession,
  readProfileRows,
  suspendUser,
  updateInput,
  updateMyProfile,
} from '../../../../../test/support/profile-graphql-operations.ts';

const ALICE = 1;
const BOB = 2;

const UPDATE_BOT_TOKEN = botTokenFor('profile_update');

installProfileGraphQLTest();

async function insertAlice(
  columns: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  await insertUser(ALICE, { handle: 'alice', nickname: 'アリス', ...columns });
  return issueUserSession(ALICE);
}

async function save(
  sessionToken: string,
  overrides: Record<string, unknown> = {},
) {
  return updateMyProfile(
    updateInput({ handle: 'alice', expectedHandle: 'alice', ...overrides }),
    { sessionToken, botToken: UPDATE_BOT_TOKEN },
  );
}

describe('呼び出し元の確認', () => {
  test.each([
    ['publicProfile', () => fetchPublicProfile('alice', { caller: 'admin' })],
    ['myProfile', () => fetchMyProfile({ caller: 'admin' })],
    [
      'handleAvailability',
      () => fetchHandleAvailability('alice', { caller: 'admin' }),
    ],
    [
      'updateMyProfile',
      () =>
        updateMyProfile(updateInput(), {
          caller: 'admin',
          botToken: UPDATE_BOT_TOKEN,
        }),
    ],
  ])(
    '管理者側の呼び出し元からの%sは、bot判定の前にforbiddenで拒否する',
    async (_name, call) => {
      const calls = stubExternalServices();
      await insertAlice();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.errors?.[0]?.message).toBe('この操作はできません。');
      expect(calls.siteverifyTokens).toEqual([]);
      expect((await readProfileRows(ALICE)).profile).toEqual([]);
    },
  );
});

describe('updateMyProfile', () => {
  test('プロフィールを保存し、前後の空白を除いた値と空にした任意項目のnullを返す', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();

    const response = await save(token, {
      nickname: '  新しいアリス  ',
      headline: '  個人開発者  ',
      bio: '**自己紹介**\n\n[リンク](https://link.example/)',
      websites: [
        { name: '  GitHub ', url: ' https://github.example/alice ' },
        { name: '   ', url: 'http://blog.example/' },
        { name: null, url: 'https://third.example/' },
      ],
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateMyProfile).toEqual({
      nickname: '新しいアリス',
      handle: 'alice',
      previousHandle: null,
      headline: '個人開発者',
      bio: '**自己紹介**\n\n[リンク](https://link.example/)',
      avatar: null,
      websites: [
        { name: 'GitHub', url: 'https://github.example/alice' },
        { name: null, url: 'http://blog.example/' },
        { name: null, url: 'https://third.example/' },
      ],
      suspended: false,
    });
    expect(calls.siteverifyTokens).toEqual([UPDATE_BOT_TOKEN]);
    const rows = await readProfileRows(ALICE);
    expect(
      rows.websites.map((row) => [row.position, row.name, row.url]),
    ).toEqual([
      [0, 'GitHub', 'https://github.example/alice'],
      [1, null, 'http://blog.example/'],
      [2, null, 'https://third.example/'],
    ]);
  });

  test('空文字列のヘッドラインと空白だけの自己紹介はnullとして保存する', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await save(token, { headline: '', bio: ' \n ' });

    expect(response.data?.updateMyProfile).toMatchObject({
      headline: null,
      bio: null,
    });
    expect((await readProfileRows(ALICE)).profile).toEqual([
      expect.objectContaining({ headline: null, bioMarkdown: null }),
    ]);
  });

  test('メールアドレスが未確認の利用者も保存できる', async () => {
    stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });

    const response = await save(token, { headline: '未確認でも保存できる' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateMyProfile?.headline).toBe(
      '未確認でも保存できる',
    );
  });

  test('ハンドルを変えると旧ハンドルを返し、myProfileとpublicProfileに反映される', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await save(token, { handle: 'alice-new' });

    expect(response.data?.updateMyProfile).toMatchObject({
      handle: 'alice-new',
      previousHandle: 'alice',
    });
    const mine = await fetchMyProfile({ sessionToken: token });
    expect(mine.data?.myProfile).toMatchObject({
      handle: 'alice-new',
      previousHandle: 'alice',
    });
    const redirected = await fetchPublicProfile('alice');
    expect(redirected.data?.publicProfile).toEqual({
      __typename: 'PublicProfileRedirect',
      handle: 'alice-new',
    });
  });

  test('本人のアップロード済みの画像を設定すると、画像を返す', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertFile(1, {
      purpose: USER_AVATAR_PURPOSE,
      ownerId: userIdOf(ALICE),
    });

    const response = await save(token, { avatarFileId: fileIdOf(1) });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateMyProfile?.avatar).toEqual({
      id: fileIdOf(1),
      objectKey: objectKeyOf(1),
    });
  });

  test.each([
    [
      '他の利用者の画像',
      () =>
        insertFile(1, {
          purpose: USER_AVATAR_PURPOSE,
          ownerId: userIdOf(BOB),
        }),
      fileIdOf(1),
    ],
    [
      '用途が違う画像',
      () => insertFile(1, { ownerId: userIdOf(ALICE) }),
      fileIdOf(1),
    ],
    ['存在しない画像', () => Promise.resolve(), fileIdOf(9)],
  ])('%sは保存せずinvalid_uploadで拒否する', async (_name, prepare, fileId) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob' });
    await prepare();

    const response = await save(token, { avatarFileId: fileId });

    expect(codesOf(response)).toEqual(['invalid_upload']);
    expect(response.errors?.[0]?.message).toBe(
      'プロフィール画像をもう一度選択してください。',
    );
    expect((await readProfileRows(ALICE)).profile).toEqual([]);
  });

  test.each([
    ['他の利用者の現在のハンドル', 'bob'],
    ['大文字小文字だけが違う他の利用者のハンドル', 'BOB'],
    ['予約語', 'admin'],
    ['大文字の予約語', 'Admin'],
  ])('%sはhandle_unavailableと欄の詳細で拒否する', async (_name, handle) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob' });

    const response = await save(token, { handle });

    expect(codesOf(response)).toEqual(['handle_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      'このハンドルは既に使われています。別の文字列を入力してください。',
    );
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.handle',
        code: 'unavailable',
        message:
          'このハンドルは既に使われています。別の文字列を入力してください。',
      },
    ]);
    const mine = await fetchMyProfile({ sessionToken: token });
    expect(mine.data?.myProfile?.handle).toBe('alice');
  });

  test('他の利用者が旧ハンドルとして保持している文字列には変更できる', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob' });
    await insertPreviousHandle(1, BOB, 'old-bob');

    const response = await save(token, { handle: 'old-bob' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateMyProfile?.handle).toBe('old-bob');
  });

  test('画面を開いた後にハンドルが変わっていれば、保存せずprofile_update_conflictで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await save(token, {
      expectedHandle: 'alice-before',
      headline: '保存されない',
    });

    expect(codesOf(response)).toEqual(['profile_update_conflict']);
    expect(response.errors?.[0]?.message).toBe(
      'プロフィールが別の画面で変更されました。最新の内容を読み込んでから保存してください。',
    );
    expect((await readProfileRows(ALICE)).profile).toEqual([]);
  });

  test('未ログインの保存は、bot判定を使わずunauthenticatedで拒否する', async () => {
    const calls = stubExternalServices();
    await insertAlice();

    const response = await updateMyProfile(updateInput(), {
      botToken: UPDATE_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('停止中の利用者の保存は、bot判定を使わずaccount_unavailableで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await suspendUser(ALICE);

    const response = await save(token, { headline: '保存されない' });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect((await readProfileRows(ALICE)).profile).toEqual([]);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    ['判定に失敗する', BOT_REJECTED_TOKEN, 'bot_verification_failed'],
    [
      'フォローの操作名の判定の結果である',
      botTokenFor('follow'),
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は保存せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await updateMyProfile(
      updateInput({ handle: 'alice', expectedHandle: 'alice' }),
      botToken === undefined
        ? { sessionToken: token }
        : { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect((await readProfileRows(ALICE)).profile).toEqual([]);
  });
});

describe('updateMyProfileの入力の検証', () => {
  const NICKNAME_REQUIRED = 'ニックネームを入力してください。';
  const NICKNAME_TOO_LONG = 'ニックネームは25文字以内で入力してください。';
  const HANDLE_REQUIRED = 'ハンドルを入力してください。';
  const HANDLE_TOO_LONG = 'ハンドルは25文字以内で入力してください。';
  const HANDLE_FORMAT =
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。';
  const URL_REQUIRED = '外部WebサイトのURLを入力してください。';
  const URL_TOO_LONG = '外部WebサイトURLは2,048文字以内で入力してください。';
  const URL_FORMAT =
    '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。';

  test.each([
    [
      '空白だけのニックネーム',
      { nickname: ' 　 ' },
      'input.nickname',
      NICKNAME_REQUIRED,
    ],
    [
      '26書記素のニックネーム',
      { nickname: 'あ'.repeat(26) },
      'input.nickname',
      NICKNAME_TOO_LONG,
    ],
    ['空のハンドル', { handle: '' }, 'input.handle', HANDLE_REQUIRED],
    [
      '26文字のハンドル',
      { handle: 'a'.repeat(26) },
      'input.handle',
      HANDLE_TOO_LONG,
    ],
    [
      '先頭がハイフンのハンドル',
      { handle: '-abc' },
      'input.handle',
      HANDLE_FORMAT,
    ],
    ['空白を含むハンドル', { handle: 'a b' }, 'input.handle', HANDLE_FORMAT],
    ['全角のハンドル', { handle: 'ａｂｃ' }, 'input.handle', HANDLE_FORMAT],
    [
      'アクセント付きのハンドル',
      { handle: 'café' },
      'input.handle',
      HANDLE_FORMAT,
    ],
    [
      'ヘッドラインの使用できない文字',
      { headline: '肩書き\u0007' },
      'input.headline',
      'ヘッドラインに使用できない文字が含まれています。',
    ],
    [
      '51書記素のヘッドライン',
      { headline: 'あ'.repeat(51) },
      'input.headline',
      'ヘッドラインは50文字以内で入力してください。',
    ],
    [
      '自己紹介の使用できない文字',
      { bio: '自己紹介\u0000' },
      'input.bio',
      '自己紹介に使用できない文字が含まれています。',
    ],
    [
      '5,001書記素の自己紹介',
      { bio: 'あ'.repeat(5001) },
      'input.bio',
      '自己紹介は5,000文字以内で入力してください。',
    ],
    [
      '11件の外部Webサイト',
      {
        websites: Array.from({ length: 11 }, (_, index) => ({
          name: null,
          url: `https://site${String(index)}.example/`,
        })),
      },
      'input.websites',
      '外部Webサイトは10件以内で入力してください。',
    ],
    [
      '外部Webサイトの名前の使用できない文字',
      { websites: [{ name: '名前\u0007', url: 'https://a.example/' }] },
      'input.websites.0.name',
      '外部Webサイトの名前に使用できない文字が含まれています。',
    ],
    [
      '26書記素の外部Webサイトの名前',
      { websites: [{ name: 'あ'.repeat(26), url: 'https://a.example/' }] },
      'input.websites.0.name',
      '外部Webサイトの名前は25文字以内で入力してください。',
    ],
    [
      'URLが空の外部Webサイト',
      { websites: [{ name: 'GitHub', url: '' }] },
      'input.websites.0.url',
      URL_REQUIRED,
    ],
    [
      '空白だけのURL',
      { websites: [{ name: null, url: '  ' }] },
      'input.websites.0.url',
      URL_REQUIRED,
    ],
    [
      '2,049文字のURL',
      {
        websites: [
          { name: null, url: `https://a.example/${'a'.repeat(2049 - 18)}` },
        ],
      },
      'input.websites.0.url',
      URL_TOO_LONG,
    ],
    [
      'javascriptスキームのURL',
      { websites: [{ name: null, url: 'javascript:alert(1)' }] },
      'input.websites.0.url',
      URL_FORMAT,
    ],
    [
      '相対URL',
      { websites: [{ name: null, url: '/profile' }] },
      'input.websites.0.url',
      URL_FORMAT,
    ],
    [
      'スキームの直後に//が無いURL',
      { websites: [{ name: null, url: 'https:a.example' }] },
      'input.websites.0.url',
      URL_FORMAT,
    ],
  ])(
    '%sは保存せずvalidation_errorと欄ごとの詳細で拒否する',
    async (_name, overrides, field, message) => {
      const calls = stubExternalServices();
      const token = await insertAlice();

      const response = await save(token, overrides);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field, message }),
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect((await readProfileRows(ALICE)).profile).toEqual([]);
    },
  );

  test('複数の違反は欄ごとに全て示し、外部Webサイトは行の位置を欄の経路に含める', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await save(token, {
      nickname: '',
      websites: [
        { name: null, url: 'https://ok.example/' },
        { name: null, url: 'https://ok2.example/' },
        { name: null, url: 'ftp://bad.example/' },
      ],
    });

    expect(detailsOf(response).map((detail) => detail.field)).toEqual([
      'input.nickname',
      'input.websites.2.url',
    ]);
  });

  test('10件の外部Webサイト・25書記素のニックネーム・25文字のハンドル・5,000書記素の自己紹介は保存できる', async () => {
    stubExternalServices();
    const token = await insertAlice();
    const handle = 'a'.repeat(25);

    const response = await save(token, {
      nickname: 'あ'.repeat(25),
      handle,
      headline: 'あ'.repeat(50),
      bio: 'あ'.repeat(5000),
      websites: Array.from({ length: 10 }, (_, index) => ({
        name: 'あ'.repeat(25),
        url: `https://site${String(index)}.example/`,
      })),
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateMyProfile?.websites).toHaveLength(10);
    expect(response.data?.updateMyProfile?.handle).toBe(handle);
  });
});

describe('myProfile', () => {
  test('未ログインはunauthenticatedで拒否する', async () => {
    const response = await fetchMyProfile();

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('プロフィールの行が無い利用者は、ニックネームとハンドルだけを返す', async () => {
    const token = await insertAlice();

    const response = await fetchMyProfile({ sessionToken: token });

    expect(response.data?.myProfile).toEqual({
      nickname: 'アリス',
      handle: 'alice',
      previousHandle: null,
      headline: null,
      bio: null,
      avatar: null,
      websites: [],
      suspended: false,
    });
  });

  test('保持中の旧ハンドルを返す', async () => {
    const token = await insertAlice();
    await insertPreviousHandle(1, ALICE, 'alice-old');

    const response = await fetchMyProfile({ sessionToken: token });

    expect(response.data?.myProfile?.previousHandle).toBe('alice-old');
  });

  test('論理削除済みの旧ハンドルは返さない', async () => {
    const token = await insertAlice();
    await insertPreviousHandle(1, ALICE, 'alice-old', { deletedAt: after(1) });

    const response = await fetchMyProfile({ sessionToken: token });

    expect(response.data?.myProfile?.previousHandle).toBeNull();
  });

  test('停止中の利用者も自分のプロフィールを読め、停止中として返す', async () => {
    const token = await insertAlice();
    await suspendUser(ALICE);

    const response = await fetchMyProfile({ sessionToken: token });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myProfile?.suspended).toBe(true);
  });
});

describe('handleAvailability', () => {
  test('未ログインはunauthenticatedで拒否する', async () => {
    const response = await fetchHandleAvailability('fresh');

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test.each([
    ['誰も使っていないハンドル', 'fresh', 'AVAILABLE'],
    ['自分の現在のハンドル', 'alice', 'AVAILABLE'],
    ['大文字小文字だけが違う自分の現在のハンドル', 'ALICE', 'AVAILABLE'],
    ['自分の保持中の旧ハンドル', 'alice-old', 'AVAILABLE'],
    ['他の利用者が旧ハンドルとして保持している文字列', 'old-bob', 'AVAILABLE'],
    ['他の利用者の現在のハンドル', 'bob', 'UNAVAILABLE'],
    ['大文字小文字だけが違う他の利用者のハンドル', 'Bob', 'UNAVAILABLE'],
    ['予約語', 'admin', 'UNAVAILABLE'],
    ['空のハンドル', '', 'INVALID'],
    ['先頭がハイフンのハンドル', '-abc', 'INVALID'],
    ['全角のハンドル', 'ａｂｃ', 'INVALID'],
    ['空白を含むハンドル', 'a b', 'INVALID'],
  ])('%sは%sではなく判定の結果を返す', async (_name, handle, expected) => {
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob' });
    await insertPreviousHandle(1, ALICE, 'alice-old');
    await insertPreviousHandle(2, BOB, 'old-bob');

    const response = await fetchHandleAvailability(handle, {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.handleAvailability).toBe(expected);
  });

  test('26文字以上のハンドルはvalidation_errorで拒否する', async () => {
    const token = await insertAlice();

    const response = await fetchHandleAvailability('a'.repeat(26), {
      sessionToken: token,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'handle',
        message: 'ハンドルは25文字以内で入力してください。',
      }),
    ]);
  });

  test('停止中の利用者も判定を読める', async () => {
    const token = await insertAlice();
    await suspendUser(ALICE);

    const response = await fetchHandleAvailability('fresh', {
      sessionToken: token,
    });

    expect(response.data?.handleAvailability).toBe('AVAILABLE');
  });
});

describe('publicProfile', () => {
  async function insertBobWithProfile(): Promise<void> {
    await insertUser(BOB, { handle: 'Bob', nickname: 'ボブ' });
    const token = await issueUserSession(BOB);
    stubExternalServices();
    const response = await updateMyProfile(
      updateInput({
        nickname: 'ボブ',
        handle: 'Bob',
        expectedHandle: 'Bob',
        headline: '個人開発者',
        bio: '自己紹介です',
        websites: [{ name: 'GitHub', url: 'https://github.example/bob' }],
      }),
      { sessionToken: token, botToken: UPDATE_BOT_TOKEN },
    );
    expect(response.errors).toBeUndefined();
  }

  test('未ログインの閲覧者にもプロフィールを返し、大文字小文字を区別せずハンドルを引く', async () => {
    await insertAlice();
    await insertBobWithProfile();

    const response = await fetchPublicProfile('bOB');

    expect(response.errors).toBeUndefined();
    expect(response.data?.publicProfile).toEqual({
      __typename: 'PublicProfile',
      handle: 'Bob',
      nickname: 'ボブ',
      headline: '個人開発者',
      bio: '自己紹介です',
      avatar: null,
      websites: [{ name: 'GitHub', url: 'https://github.example/bob' }],
      followerCount: 0,
      ultras: false,
      suspended: false,
      viewerRelation: 'GUEST',
    });
  });

  test('任意項目が未設定のプロフィールは、nullと空の一覧で返す', async () => {
    await insertAlice();

    const response = await fetchPublicProfile('alice');

    expect(response.data?.publicProfile).toMatchObject({
      __typename: 'PublicProfile',
      headline: null,
      bio: null,
      avatar: null,
      websites: [],
    });
  });

  test('フォロワー数は停止中の利用者を除いて数え、閲覧者との関係を返す', async () => {
    const aliceToken = await insertAlice();
    await insertBobWithProfile();
    await insertUser(3, { handle: 'carol' });
    await insertUser(4, {
      handle: 'dave',
      status: 'suspended',
      suspendedAt: after(1),
    });
    await db.insert(userFollows).values([
      {
        id: '01JC0FLW000000000000000001',
        followerId: userIdOf(ALICE),
        followeeId: userIdOf(BOB),
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: '01JC0FLW000000000000000002',
        followerId: userIdOf(3),
        followeeId: userIdOf(BOB),
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: '01JC0FLW000000000000000003',
        followerId: userIdOf(4),
        followeeId: userIdOf(BOB),
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    const bobToken = await issueUserSession(BOB);

    const asAlice = await fetchPublicProfile('Bob', {
      sessionToken: aliceToken,
    });
    const asBob = await fetchPublicProfile('Bob', { sessionToken: bobToken });
    const asGuest = await fetchPublicProfile('Bob');

    expect(asAlice.data?.publicProfile).toMatchObject({
      followerCount: 2,
      viewerRelation: 'FOLLOWING',
    });
    expect(asBob.data?.publicProfile).toMatchObject({
      followerCount: 2,
      viewerRelation: 'OWNER',
    });
    expect(asGuest.data?.publicProfile).toMatchObject({
      viewerRelation: 'GUEST',
    });
  });

  test('旧ハンドルは現在のハンドルへの転送を返す', async () => {
    await insertAlice();
    await insertPreviousHandle(1, ALICE, 'alice-old');

    const response = await fetchPublicProfile('ALICE-OLD');

    expect(response.data?.publicProfile).toEqual({
      __typename: 'PublicProfileRedirect',
      handle: 'alice',
    });
  });

  test.each([
    ['存在しないハンドル', 'nobody'],
    ['形式が正しくないハンドル', '-abc'],
    ['26文字のハンドル', 'a'.repeat(26)],
    ['空のハンドル', ''],
  ])('%sはnullを返す', async (_name, handle) => {
    await insertAlice();

    const response = await fetchPublicProfile(handle);

    expect(response.errors).toBeUndefined();
    expect(response.data?.publicProfile).toBeNull();
  });

  test('停止中・退会済みの利用者は他の閲覧者にはnullを返し、停止中の本人にだけ停止中として返す', async () => {
    const aliceToken = await insertAlice();
    await suspendUser(ALICE);
    await insertUser(BOB, { handle: 'bob', deletedAt: after(1) });
    await insertPreviousHandle(1, ALICE, 'alice-old');

    const asGuest = await fetchPublicProfile('alice');
    const asOwner = await fetchPublicProfile('alice', {
      sessionToken: aliceToken,
    });
    const redirectAsGuest = await fetchPublicProfile('alice-old');
    const deleted = await fetchPublicProfile('bob');

    expect(asGuest.data?.publicProfile).toBeNull();
    expect(asOwner.data?.publicProfile).toMatchObject({
      __typename: 'PublicProfile',
      suspended: true,
      viewerRelation: 'OWNER',
    });
    expect(redirectAsGuest.data?.publicProfile).toBeNull();
    expect(deleted.data?.publicProfile).toBeNull();
  });
});
