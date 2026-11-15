import { describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../../../common-lib/inquiry/inquiry-category-constants.ts';
import {
  insertUser,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  randomClientIp,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
  fetchInquiryCategories,
  fetchInquiryComposer,
  fetchMemberInquiry,
  fetchMyInquiries,
  guestInquiryInput,
  installInquiryGraphQLTest,
  issueUserSession,
  memberInquiryInput,
  postInquiryMessage,
  submitGuestInquiry,
  submitMemberInquiry,
} from '../../../../../test/support/inquiry-graphql-operations.ts';
import {
  insertMemberInquiry,
  memberInquiryIdOf,
  readGuestInquiryRows,
  readMemberInquiryRows,
  readMessageRows,
} from '../../../../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';

const OWNER = 1;

const GUEST_BOT_TOKEN = botTokenFor('inquiry_guest');

const MEMBER_BOT_TOKEN = botTokenFor('inquiry_member');

installInquiryGraphQLTest();

async function insertActiveOwner(): Promise<string> {
  await insertUser(OWNER);
  return issueUserSession(OWNER);
}

describe('呼び出し元の確認', () => {
  test.each([
    ['inquiryCategories', () => fetchInquiryCategories({ caller: 'admin' })],
    ['inquiryComposer', () => fetchInquiryComposer({ caller: 'admin' })],
    ['myInquiries', () => fetchMyInquiries(null, { caller: 'admin' })],
    [
      'memberInquiry',
      () => fetchMemberInquiry(memberInquiryIdOf(1), { caller: 'admin' }),
    ],
    [
      'submitGuestInquiry',
      () =>
        submitGuestInquiry(guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID), {
          caller: 'admin',
          botToken: GUEST_BOT_TOKEN,
        }),
    ],
    [
      'submitMemberInquiry',
      () =>
        submitMemberInquiry(memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID), {
          caller: 'admin',
          botToken: MEMBER_BOT_TOKEN,
        }),
    ],
    [
      'postInquiryMessage',
      () =>
        postInquiryMessage(
          memberInquiryIdOf(1),
          { body: '追加の質問です。', fileIds: [] },
          { caller: 'admin' },
        ),
    ],
  ])(
    '管理者側の呼び出し元からの%sは、bot判定の前にforbiddenで拒否する',
    async (_name, call) => {
      const calls = stubExternalServices();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.errors?.[0]?.message).toBe('この操作はできません。');
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readGuestInquiryRows()).toEqual([]);
    },
  );
});

describe('submitGuestInquiry', () => {
  test('未ログインの送信は未ログインの問い合わせのbot判定を求め、前後の空白を除いた連絡先で「未対応」として保存する', async () => {
    const calls = stubExternalServices();

    const response = await submitGuestInquiry(
      guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID, {
        nickname: ' ゲスト ',
        email: ' guest@mail.example ',
        body: '  ログインできません。\n',
      }),
      { botToken: GUEST_BOT_TOKEN },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.submitGuestInquiry).toBe(true);
    expect(calls.siteverifyTokens).toEqual([GUEST_BOT_TOKEN]);
    expect(await readGuestInquiryRows()).toEqual([
      expect.objectContaining({
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        nickname: 'ゲスト',
        email: 'guest@mail.example',
        body: '  ログインできません。\n',
        status: 'open',
      }),
    ]);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    ['判定に失敗する', BOT_REJECTED_TOKEN, 'bot_verification_failed'],
    [
      'ログインの問い合わせの操作名の判定の結果である',
      MEMBER_BOT_TOKEN,
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は保存せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();

    const response = await submitGuestInquiry(
      guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      botToken === undefined ? {} : { botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect(await readGuestInquiryRows()).toEqual([]);
  });

  test('同じ送信元IPアドレスからの6回目の送信は、保存せずに429と再送までの秒数で拒否する', async () => {
    stubExternalServices();
    const clientIp = randomClientIp();
    const send = () =>
      submitGuestInquiry(guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID), {
        botToken: GUEST_BOT_TOKEN,
        clientIp,
      });
    for (let count = 0; count < 5; count += 1) {
      expect((await send()).data?.submitGuestInquiry).toBe(true);
    }

    const response = await send();

    expect(response.status).toBe(429);
    expect(codesOf(response)).toEqual(['rate_limit_exceeded']);
    expect(response.errors?.[0]?.message).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await readGuestInquiryRows()).toHaveLength(5);
  });

  test.each([
    [
      'ニックネームの使用できない文字',
      { nickname: 'ゲスト\u0007' },
      'input.nickname',
      'ニックネームに使用できない文字が含まれています。',
    ],
    [
      '空白だけのニックネーム',
      { nickname: '　 ' },
      'input.nickname',
      'ニックネームを入力してください。',
    ],
    [
      '26書記素のニックネーム',
      { nickname: 'あ'.repeat(26) },
      'input.nickname',
      'ニックネームは25文字以内で入力してください。',
    ],
    [
      '形式の正しくない連絡先',
      { email: 'guest.mail.example' },
      'input.email',
      'メールアドレスの形式が正しくありません。',
    ],
    [
      '255文字の連絡先',
      { email: `${'a'.repeat(242)}@mail.example` },
      'input.email',
      'メールアドレスは254文字以内で入力してください。',
    ],
    [
      'メッセージの使用できない文字',
      { body: '本文\u0000' },
      'input.body',
      'メッセージに使用できない文字が含まれています。',
    ],
    [
      '空白だけのメッセージ',
      { body: ' \n\t' },
      'input.body',
      'メッセージを入力してください。',
    ],
    [
      '5,001書記素のメッセージ',
      { body: 'あ'.repeat(5001) },
      'input.body',
      'メッセージは5,000文字以内で入力してください。',
    ],
  ])(
    '%sは、bot判定の前に欄ごとの検証のエラーで拒否する',
    async (_name, overrides, field, message) => {
      const calls = stubExternalServices();

      const response = await submitGuestInquiry(
        guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID, overrides),
        { botToken: GUEST_BOT_TOKEN },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field, message }),
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test('存在しないカテゴリはカテゴリの欄の検証のエラーで拒否する', async () => {
    stubExternalServices();

    const response = await submitGuestInquiry(
      guestInquiryInput('01JC0CTGY00000000000000099'),
      { botToken: GUEST_BOT_TOKEN },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.categoryId',
        code: 'not-found',
        message: 'カテゴリを選択してください。',
      },
    ]);
    expect(await readGuestInquiryRows()).toEqual([]);
  });

  test('停止していないログイン中の利用者は、bot判定の前に未ログインの問い合わせを拒否する', async () => {
    const calls = stubExternalServices();
    const sessionToken = await insertActiveOwner();

    const response = await submitGuestInquiry(
      guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      { botToken: GUEST_BOT_TOKEN, sessionToken },
    );

    expect(codesOf(response)).toEqual(['member_inquiry_required']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readGuestInquiryRows()).toEqual([]);
  });

  test('停止中の利用者の送信はアカウントに紐付けずに未ログインの問い合わせとして保存する', async () => {
    stubExternalServices();
    await insertUser(OWNER, { status: 'suspended' });
    const sessionToken = await issueUserSession(OWNER);

    const response = await submitGuestInquiry(
      guestInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      { botToken: GUEST_BOT_TOKEN, sessionToken },
    );

    expect(response.data?.submitGuestInquiry).toBe(true);
    expect(await readGuestInquiryRows()).toHaveLength(1);
    expect(await readMemberInquiryRows()).toEqual([]);
  });
});

describe('submitMemberInquiry', () => {
  test('ログインの送信はログインの問い合わせのbot判定を求め、最初のメッセージを持つ問い合わせを返す', async () => {
    const calls = stubExternalServices();
    const sessionToken = await insertActiveOwner();

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID, { body: ' 本文\n' }),
      { botToken: MEMBER_BOT_TOKEN, sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(calls.siteverifyTokens).toEqual([MEMBER_BOT_TOKEN]);
    const inquiry = response.data?.submitMemberInquiry;
    expect(inquiry).toMatchObject({
      category: {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
      },
      status: 'OPEN',
      canPost: true,
      messages: [
        { sender: 'USER', body: ' 本文\n', attachments: [], admin: null },
      ],
    });
    expect(await readMemberInquiryRows()).toEqual([
      expect.objectContaining({ id: inquiry?.id, userId: userIdOf(OWNER) }),
    ]);
  });

  test.each([
    ['トークンが無い', undefined],
    ['未ログインの問い合わせの操作名の判定の結果である', GUEST_BOT_TOKEN],
  ])('bot判定の%s場合は保存せずに拒否する', async (_name, botToken) => {
    stubExternalServices();
    const sessionToken = await insertActiveOwner();

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      botToken === undefined ? { sessionToken } : { botToken, sessionToken },
    );

    expect(codesOf(response)).toEqual(['bot_verification_failed']);
    expect(await readMemberInquiryRows()).toEqual([]);
  });

  test('未ログインの送信は、bot判定の前に拒否する', async () => {
    const calls = stubExternalServices();

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      { botToken: MEMBER_BOT_TOKEN },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('停止中の利用者の送信は、bot判定の前に拒否する', async () => {
    const calls = stubExternalServices();
    await insertUser(OWNER, { status: 'suspended' });
    const sessionToken = await issueUserSession(OWNER);

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID),
      { botToken: MEMBER_BOT_TOKEN, sessionToken },
    );

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readMemberInquiryRows()).toEqual([]);
  });

  test('21件の添付は、bot判定の前に添付の欄の件数の超過で拒否する', async () => {
    const calls = stubExternalServices();
    const sessionToken = await insertActiveOwner();
    const fileIds = Array.from(
      { length: 21 },
      (_, index) => `01JC0F${String(index + 1).padStart(20, '0')}`,
    );

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID, { fileIds }),
      { botToken: MEMBER_BOT_TOKEN, sessionToken },
    );

    expect(codesOf(response)).toEqual(['inquiry_attachments_invalid']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.fileIds',
        code: 'too-many',
        message: 'ファイルは20個以内で選択してください。',
      },
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('アップロードしていないファイルの添付は、要求の位置の欄で拒否する', async () => {
    stubExternalServices();
    const sessionToken = await insertActiveOwner();

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID, {
        fileIds: ['01JC0F00000000000000000099'],
      }),
      { botToken: MEMBER_BOT_TOKEN, sessionToken },
    );

    expect(codesOf(response)).toEqual(['inquiry_attachments_invalid']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'input.fileIds.0', code: 'invalid' }),
    ]);
    expect(await readMemberInquiryRows()).toEqual([]);
  });

  test('5,001書記素のメッセージは、bot判定の前に検証のエラーで拒否する', async () => {
    const calls = stubExternalServices();
    const sessionToken = await insertActiveOwner();

    const response = await submitMemberInquiry(
      memberInquiryInput(INQUIRY_CATEGORY_OTHER_ID, {
        body: 'あ'.repeat(5001),
      }),
      { botToken: MEMBER_BOT_TOKEN, sessionToken },
    );

    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.body',
        message: 'メッセージは5,000文字以内で入力してください。',
      }),
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });
});

describe('postInquiryMessage', () => {
  test('追加メッセージはbot判定を求めずに保存する', async () => {
    const calls = stubExternalServices();
    const sessionToken = await insertActiveOwner();
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await postInquiryMessage(
      memberInquiryIdOf(1),
      { body: ' 追加の質問です。', fileIds: [] },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.postInquiryMessage).toMatchObject({
      sender: 'USER',
      body: ' 追加の質問です。',
      attachments: [],
      admin: null,
    });
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readMessageRows()).toHaveLength(1);
  });

  test('規則に合わないメッセージは入力の欄の検証のエラーで拒否する', async () => {
    stubExternalServices();
    const sessionToken = await insertActiveOwner();
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await postInquiryMessage(
      memberInquiryIdOf(1),
      { body: 'あ'.repeat(1001), fileIds: [] },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.body',
        code: 'too-long',
        message: 'メッセージは1,000文字以内で入力してください。',
      },
    ]);
  });

  test('他人の問い合わせへの追加メッセージは、存在を明かさずに見つからないで拒否する', async () => {
    stubExternalServices();
    await insertUser(2);
    const sessionToken = await insertActiveOwner();
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID }, 2);

    const response = await postInquiryMessage(
      memberInquiryIdOf(1),
      { body: '追加の質問です。', fileIds: [] },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['inquiry_not_found']);
    expect(await readMessageRows()).toEqual([]);
  });
});
