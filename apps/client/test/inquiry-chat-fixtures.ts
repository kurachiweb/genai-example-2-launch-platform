import type { ClientMemberInquiryQuery } from '../src/graphql/generated/graphql.ts';

type MemberInquiryResult = NonNullable<
  ClientMemberInquiryQuery['memberInquiry']
>;

export type InquiryChatMessageResult = MemberInquiryResult['messages'][number];

export const CHAT_INQUIRY_ID = '01JC0INQVRY000000000000001';

export const ADMIN_NICKNAME = 'サポート担当';

export const ADMIN_AVATAR_KEY = '76543210fedcba98'.repeat(2);

export const firstMessage = (): InquiryChatMessageResult => ({
  id: CHAT_INQUIRY_ID,
  sender: 'USER',
  body: '画面が表示されません。',
  createdAt: '2026-11-04T01:00:00.000Z',
  attachments: [
    {
      id: '01JC0F1LE00000000000000001',
      originalFileName: 'screenshot.png',
      contentType: 'image/png',
      byteSize: 2048,
    },
  ],
  admin: null,
});

export const adminReply = (): InquiryChatMessageResult => ({
  id: '01JC0MESSAGE00000000000002',
  sender: 'ADMIN',
  body: '状況を確認します。',
  createdAt: '2026-11-04T02:00:00.000Z',
  attachments: [],
  admin: {
    nickname: ADMIN_NICKNAME,
    avatar: {
      objectKey: ADMIN_AVATAR_KEY,
      fallbackFormat: 'PNG',
      width: 512,
      height: 512,
    },
    deleted: false,
  },
});

export const deletedAdminReply = (): InquiryChatMessageResult => ({
  id: '01JC0MESSAGE00000000000003',
  sender: 'ADMIN',
  body: '対応しました。',
  createdAt: '2026-11-04T03:00:00.000Z',
  attachments: [],
  admin: { nickname: null, avatar: null, deleted: true },
});

export const userMessage = (
  id: string,
  body: string,
  createdAt: string,
): InquiryChatMessageResult => ({
  id,
  sender: 'USER',
  body,
  createdAt,
  attachments: [],
  admin: null,
});

export const memberInquiryResult = (
  overrides: Partial<MemberInquiryResult> = {},
): ClientMemberInquiryQuery => ({
  memberInquiry: {
    id: CHAT_INQUIRY_ID,
    category: { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
    status: 'IN_PROGRESS',
    createdAt: '2026-11-04T01:00:00.000Z',
    messages: [firstMessage(), adminReply(), deletedAdminReply()],
    canPost: true,
    ...overrides,
  },
});
