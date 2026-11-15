import { describe, expect, test } from 'bun:test';

import { INQUIRY_STATUSES } from '../../../../../common-lib/inquiry/inquiry-status.ts';
import type {
  InquiryMessageRecord,
  MemberInquiryRecord,
} from '../../../../application/inquiry/ports.ts';
import {
  INQUIRY_KIND_VALUES,
  INQUIRY_STATUS_VALUES,
  type InquiryMessageModel,
  inquiryKindOf,
  inquiryStatusOf,
  toAdminInquiry,
  toAdminInquiryCategory,
  toAdminInquiryPage,
  toInquiryComposer,
  toInquiryReplyAuthor,
  toInquiryReplyResult,
  toMemberInquiry,
  toMemberInquiryPage,
} from './mappers.ts';

const CREATED_AT = new Date('2026-11-05T00:00:00.000Z');

const CHANGED_AT = new Date('2026-11-05T01:00:00.000Z');

const LAST_MESSAGE_AT = new Date('2026-11-05T02:00:00.000Z');

const MEMBER_INQUIRY: MemberInquiryRecord = {
  id: '01JC0M0000000000000000000A',
  userId: '01JC0USER00000000000000001',
  categoryId: '01JC0CTGY00000000000000001',
  status: 'resolved',
  statusChangedAt: CHANGED_AT,
  lastMessageAt: LAST_MESSAGE_AT,
  createdAt: CREATED_AT,
  deletedAt: null,
};

const USER_MESSAGE: InquiryMessageRecord = {
  id: '01JC0MSG000000000000000001',
  inquiryId: MEMBER_INQUIRY.id,
  sender: 'user',
  adminId: null,
  body: '質問です。',
  fileIds: ['01JC0F00000000000000000001'],
  createdAt: CREATED_AT,
};

const ADMIN_REPLY: InquiryMessageRecord = {
  id: '01JC0MSG000000000000000002',
  inquiryId: MEMBER_INQUIRY.id,
  sender: 'admin',
  adminId: '01JC0ADMN00000000000000001',
  body: '回答です。',
  fileIds: [],
  createdAt: LAST_MESSAGE_AT,
};

const USER_MESSAGE_MODEL: InquiryMessageModel = {
  id: USER_MESSAGE.id,
  sender: 'USER',
  body: '質問です。',
  fileIds: USER_MESSAGE.fileIds,
  adminId: null,
  createdAt: CREATED_AT,
};

const ADMIN_REPLY_MODEL: InquiryMessageModel = {
  id: ADMIN_REPLY.id,
  sender: 'ADMIN',
  body: '回答です。',
  fileIds: [],
  adminId: ADMIN_REPLY.adminId,
  createdAt: LAST_MESSAGE_AT,
};

describe('列挙型の相互変換', () => {
  test('4つのステータスを列挙型の値と1対1に対応させる', () => {
    expect(
      INQUIRY_STATUSES.map((status) => INQUIRY_STATUS_VALUES[status]),
    ).toEqual(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']);
    for (const status of INQUIRY_STATUSES) {
      expect(inquiryStatusOf(INQUIRY_STATUS_VALUES[status])).toBe(status);
    }
  });

  test('2つの種別を列挙型の値と1対1に対応させる', () => {
    expect(INQUIRY_KIND_VALUES).toEqual({ member: 'MEMBER', guest: 'GUEST' });
    expect(inquiryKindOf('MEMBER')).toBe('member');
    expect(inquiryKindOf('GUEST')).toBe('guest');
  });
});

describe('利用者側の変換', () => {
  test('問い合わせをカテゴリのIDと送信者の列挙型の値を持つメッセージへ写す', () => {
    expect(
      toMemberInquiry({
        inquiry: MEMBER_INQUIRY,
        messages: [USER_MESSAGE, ADMIN_REPLY],
        canPost: false,
      }),
    ).toEqual({
      id: MEMBER_INQUIRY.id,
      categoryId: MEMBER_INQUIRY.categoryId,
      status: 'RESOLVED',
      createdAt: CREATED_AT,
      lastMessageAt: LAST_MESSAGE_AT,
      canPost: false,
      messages: [USER_MESSAGE_MODEL, ADMIN_REPLY_MODEL],
    });
  });

  test('自分の一覧のページの行と次の位置を写す', () => {
    expect(
      toMemberInquiryPage({ items: [MEMBER_INQUIRY], nextCursor: 'next' }),
    ).toEqual({
      items: [
        {
          id: MEMBER_INQUIRY.id,
          categoryId: MEMBER_INQUIRY.categoryId,
          status: 'RESOLVED',
          createdAt: CREATED_AT,
          lastMessageAt: LAST_MESSAGE_AT,
        },
      ],
      nextCursor: 'next',
    });
  });

  test('照会口が返さない管理者は削除済みの管理者にし、返した管理者はニックネームと画像のIDを持たせる', () => {
    expect(toInquiryReplyAuthor(undefined)).toEqual({
      nickname: null,
      avatarFileId: null,
      deleted: true,
    });
    expect(
      toInquiryReplyAuthor({
        id: '01JC0ADMN00000000000000001',
        nickname: '運営の担当',
        title: null,
        avatarFileId: '01JC0F00000000000000000009',
      }),
    ).toEqual({
      nickname: '運営の担当',
      avatarFileId: '01JC0F00000000000000000009',
      deleted: false,
    });
  });

  test('送信者の表示はニックネームと画像のIDだけを持たせる', () => {
    expect(
      toInquiryComposer({
        nickname: '利用者1',
        avatarFileId: null,
      }),
    ).toEqual({ nickname: '利用者1', avatarFileId: null });
  });
});

describe('管理者側の変換', () => {
  test('紐付く件数付きのカテゴリを写し、作成日時を含めない', () => {
    expect(
      toAdminInquiryCategory({
        id: '01JC0CTGY00000000000000001',
        name: '料金',
        systemDefault: false,
        createdAt: CREATED_AT,
        linkedCount: 3,
      }),
    ).toEqual({
      id: '01JC0CTGY00000000000000001',
      name: '料金',
      systemDefault: false,
      linkedCount: 3,
    });
  });

  test('横断の一覧の行を種別とステータスの列挙型の値で写す', () => {
    expect(
      toAdminInquiryPage({
        items: [
          {
            kind: 'guest',
            id: '01JC0G0000000000000000000A',
            categoryId: '01JC0CTGY00000000000000001',
            status: 'in_progress',
            senderName: 'ゲスト',
            withdrawn: false,
            createdAt: CREATED_AT,
            lastMessageAt: CREATED_AT,
          },
        ],
        nextCursor: null,
      }),
    ).toEqual({
      entries: [
        {
          id: '01JC0G0000000000000000000A',
          kind: 'GUEST',
          categoryId: '01JC0CTGY00000000000000001',
          status: 'IN_PROGRESS',
          senderName: 'ゲスト',
          withdrawn: false,
          createdAt: CREATED_AT,
          lastMessageAt: CREATED_AT,
        },
      ],
      nextCursor: null,
    });
  });

  test('ログインの問い合わせの詳細に、送った利用者とメッセージを持たせる', () => {
    expect(
      toAdminInquiry({
        kind: 'member',
        inquiry: { ...MEMBER_INQUIRY, deletedAt: CHANGED_AT },
        withdrawn: true,
        member: {
          userId: MEMBER_INQUIRY.userId,
          nickname: '利用者1',
          handle: 'user1',
          avatarFileId: null,
        },
        messages: [USER_MESSAGE],
      }),
    ).toEqual({
      id: MEMBER_INQUIRY.id,
      kind: 'MEMBER',
      categoryId: MEMBER_INQUIRY.categoryId,
      status: 'RESOLVED',
      statusChangedAt: CHANGED_AT,
      withdrawn: true,
      createdAt: CREATED_AT,
      lastMessageAt: LAST_MESSAGE_AT,
      member: {
        userId: MEMBER_INQUIRY.userId,
        nickname: '利用者1',
        handle: 'user1',
        avatarFileId: null,
      },
      guest: null,
      messages: [USER_MESSAGE_MODEL],
    });
  });

  test('送った利用者を照会口が返さないログインの問い合わせは、送った利用者を空にする', () => {
    expect(
      toAdminInquiry({
        kind: 'member',
        inquiry: MEMBER_INQUIRY,
        withdrawn: false,
        member: undefined,
        messages: [],
      }).member,
    ).toBeNull();
  });

  test('未ログインの問い合わせの詳細は、連絡先を持たせ、本文を受付時の利用者のメッセージとして返す', () => {
    expect(
      toAdminInquiry({
        kind: 'guest',
        withdrawn: false,
        inquiry: {
          id: '01JC0G0000000000000000000A',
          categoryId: '01JC0CTGY00000000000000001',
          nickname: 'ゲスト',
          email: 'guest@mail.example',
          body: 'ログインできません。',
          status: 'open',
          statusChangedAt: CHANGED_AT,
          createdAt: CREATED_AT,
        },
      }),
    ).toEqual({
      id: '01JC0G0000000000000000000A',
      kind: 'GUEST',
      categoryId: '01JC0CTGY00000000000000001',
      status: 'OPEN',
      statusChangedAt: CHANGED_AT,
      withdrawn: false,
      createdAt: CREATED_AT,
      lastMessageAt: CREATED_AT,
      member: null,
      guest: {
        nickname: 'ゲスト',
        email: 'guest@mail.example',
        body: 'ログインできません。',
      },
      messages: [
        {
          id: '01JC0G0000000000000000000A',
          sender: 'USER',
          body: 'ログインできません。',
          fileIds: [],
          adminId: null,
          createdAt: CREATED_AT,
        },
      ],
    });
  });

  test('返信の結果のメッセージを写し、通知の可否を残す', () => {
    expect(
      toInquiryReplyResult({ message: ADMIN_REPLY, notificationQueued: false }),
    ).toEqual({
      message: ADMIN_REPLY_MODEL,
      notificationQueued: false,
    });
  });
});
