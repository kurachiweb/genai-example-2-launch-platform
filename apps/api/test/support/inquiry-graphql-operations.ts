import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { INQUIRY_TYPES } from '../../src/application/inquiry/inquiry-types.ts';
import type {
  InquiryMailer,
  InquiryReplyNotification,
} from '../../src/application/inquiry/ports.ts';
import { MODULES } from '../../src/composition/modules.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { resetInquiryTables } from '../../src/infrastructure/inquiry/testing/inquiry-store-fixtures.ts';
import { inquirySchemaModule } from '../../src/presentation/graphql/modules/inquiry/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import {
  createAdminGateway,
  issueAdminSession,
} from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface InquiryCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
}

export interface MediaImageFields {
  readonly id: string;
}

export interface MediaAttachmentFields {
  readonly id: string;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly downloadPath: string;
}

export interface InquiryMessageFields {
  readonly id: string;
  readonly sender: 'USER' | 'ADMIN';
  readonly body: string;
  readonly attachments: readonly MediaAttachmentFields[];
  readonly admin: {
    readonly nickname: string | null;
    readonly avatar: MediaImageFields | null;
    readonly deleted: boolean;
  } | null;
  readonly createdAt: string;
}

export interface MemberInquiryFields {
  readonly id: string;
  readonly category: InquiryCategoryFields;
  readonly status: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly messages: readonly InquiryMessageFields[];
  readonly canPost: boolean;
}

export interface MemberInquirySummaryFields {
  readonly id: string;
  readonly category: InquiryCategoryFields;
  readonly status: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

export interface InquiryComposerFields {
  readonly nickname: string;
  readonly avatar: MediaImageFields | null;
}

const CATEGORY_FIELDS = /* GraphQL */ `
  id
  name
  systemDefault
`;

const MESSAGE_FIELDS = /* GraphQL */ `
  id
  sender
  body
  attachments {
    id
    originalFileName
    contentType
    byteSize
    downloadPath
  }
  admin {
    nickname
    avatar {
      id
    }
    deleted
  }
  createdAt
`;

const MEMBER_INQUIRY_FIELDS = /* GraphQL */ `
  id
  category {
    ${CATEGORY_FIELDS}
  }
  status
  createdAt
  lastMessageAt
  messages {
    ${MESSAGE_FIELDS}
  }
  canPost
`;

export const INQUIRY_CATEGORIES = /* GraphQL */ `
  query ClientInquiryCategories {
    inquiryCategories {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const INQUIRY_COMPOSER = /* GraphQL */ `
  query ClientInquiryComposer {
    inquiryComposer {
      nickname
      avatar {
        id
      }
    }
  }
`;

export const MY_INQUIRIES = /* GraphQL */ `
  query ClientMyInquiries($after: String) {
    myInquiries(after: $after) {
      items {
        id
        category {
          ${CATEGORY_FIELDS}
        }
        status
        createdAt
        lastMessageAt
      }
      nextCursor
    }
  }
`;

export const MEMBER_INQUIRY = /* GraphQL */ `
  query ClientMemberInquiry($id: ID!) {
    memberInquiry(id: $id) {
      ${MEMBER_INQUIRY_FIELDS}
    }
  }
`;

export const SUBMIT_GUEST_INQUIRY = /* GraphQL */ `
  mutation ClientSubmitGuestInquiry($input: GuestInquiryInput!) {
    submitGuestInquiry(input: $input)
  }
`;

export const SUBMIT_MEMBER_INQUIRY = /* GraphQL */ `
  mutation ClientSubmitMemberInquiry($input: MemberInquiryInput!) {
    submitMemberInquiry(input: $input) {
      ${MEMBER_INQUIRY_FIELDS}
    }
  }
`;

export const POST_INQUIRY_MESSAGE = /* GraphQL */ `
  mutation ClientPostInquiryMessage(
    $inquiryId: ID!
    $input: InquiryMessageInput!
  ) {
    postInquiryMessage(inquiryId: $inquiryId, input: $input) {
      ${MESSAGE_FIELDS}
    }
  }
`;

export const inquiryGateway = createGraphQLGateway({
  documents: [
    INQUIRY_CATEGORIES,
    INQUIRY_COMPOSER,
    MY_INQUIRIES,
    MEMBER_INQUIRY,
    SUBMIT_GUEST_INQUIRY,
    SUBMIT_MEMBER_INQUIRY,
    POST_INQUIRY_MESSAGE,
  ],
  schemaModules: [mediaSchemaModule, inquirySchemaModule],
});

export interface InquiryTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前に問い合わせ・ファイル・管理者・利用者のテーブルとログの記録を空にし、外部サービスの偽物を戻す
export function installInquiryGraphQLTest(): InquiryTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await resetInquiryTables();
    await clearMediaTables();
    await clearAdminTables();
    await clearIdentityTables();
    logs.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    resetSync();
  });

  return { logs: () => logs };
}

// 問い合わせのモジュールのテストは管理者のモジュールを読み込めないため、返信した管理者の行の用意をここで行う
export function replyingAdminIdOf(index: number): string {
  return adminIdOf(index);
}

export async function insertReplyingAdmin(
  index: number,
  nickname: string,
): Promise<void> {
  await insertAdmin(index, { nickname, role: 'moderator' });
}

// 本物の発行の部品で、保存済みの利用者のセッションを作る
export async function issueUserSession(userIndex: number): Promise<string> {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
  const issued = await container
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function guestInquiryInput(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    categoryId,
    nickname: 'ゲスト',
    email: 'guest@mail.example',
    body: 'ログインできません。',
    ...overrides,
  };
}

export function memberInquiryInput(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    categoryId,
    body: '請求書の再発行をお願いします。',
    fileIds: [],
    ...overrides,
  };
}

export function fetchInquiryCategories(options?: GatewayCallOptions) {
  return inquiryGateway.call<{
    inquiryCategories: InquiryCategoryFields[] | null;
  }>(INQUIRY_CATEGORIES, {}, options);
}

export function fetchInquiryComposer(options?: GatewayCallOptions) {
  return inquiryGateway.call<{
    inquiryComposer: InquiryComposerFields | null;
  }>(INQUIRY_COMPOSER, {}, options);
}

export function fetchMyInquiries(
  after: string | null,
  options?: GatewayCallOptions,
) {
  return inquiryGateway.call<{
    myInquiries: {
      items: MemberInquirySummaryFields[];
      nextCursor: string | null;
    } | null;
  }>(MY_INQUIRIES, { after }, options);
}

export function fetchMemberInquiry(id: string, options?: GatewayCallOptions) {
  return inquiryGateway.call<{
    memberInquiry: MemberInquiryFields | null;
  }>(MEMBER_INQUIRY, { id }, options);
}

export function submitGuestInquiry(
  input: Record<string, unknown>,
  options?: GatewayCallOptions,
) {
  return inquiryGateway.call<{ submitGuestInquiry: boolean | null }>(
    SUBMIT_GUEST_INQUIRY,
    { input },
    options,
  );
}

export function submitMemberInquiry(
  input: Record<string, unknown>,
  options?: GatewayCallOptions,
) {
  return inquiryGateway.call<{
    submitMemberInquiry: MemberInquiryFields | null;
  }>(SUBMIT_MEMBER_INQUIRY, { input }, options);
}

export function postInquiryMessage(
  inquiryId: string,
  input: Record<string, unknown>,
  options?: GatewayCallOptions,
) {
  return inquiryGateway.call<{
    postInquiryMessage: InquiryMessageFields | null;
  }>(POST_INQUIRY_MESSAGE, { inquiryId, input }, options);
}

export interface AdminInquiryCategoryFields extends InquiryCategoryFields {
  readonly linkedCount: number;
}

export interface AdminInquirySummaryFields {
  readonly id: string;
  readonly kind: 'MEMBER' | 'GUEST';
  readonly category: InquiryCategoryFields;
  readonly status: string;
  readonly senderName: string;
  readonly withdrawn: boolean;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

export interface AdminInquiryFields {
  readonly id: string;
  readonly kind: 'MEMBER' | 'GUEST';
  readonly category: InquiryCategoryFields;
  readonly status: string;
  readonly statusChangedAt: string;
  readonly withdrawn: boolean;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly member: {
    readonly userId: string;
    readonly nickname: string;
    readonly handle: string;
    readonly avatar: MediaImageFields | null;
  } | null;
  readonly guest: {
    readonly nickname: string;
    readonly email: string;
    readonly body: string;
  } | null;
  readonly messages: readonly InquiryMessageFields[];
}

const ADMIN_INQUIRY_FIELDS = /* GraphQL */ `
  id
  kind
  category {
    ${CATEGORY_FIELDS}
  }
  status
  statusChangedAt
  withdrawn
  createdAt
  lastMessageAt
  member {
    userId
    nickname
    handle
    avatar {
      id
    }
  }
  guest {
    nickname
    email
    body
  }
  messages {
    ${MESSAGE_FIELDS}
  }
`;

export const ADMIN_INQUIRIES = /* GraphQL */ `
  query AdminInquiries($filter: AdminInquiryFilterInput, $after: String) {
    adminInquiries(filter: $filter, after: $after) {
      entries {
        id
        kind
        category {
          ${CATEGORY_FIELDS}
        }
        status
        senderName
        withdrawn
        createdAt
        lastMessageAt
      }
      nextCursor
    }
  }
`;

export const ADMIN_INQUIRY = /* GraphQL */ `
  query AdminInquiry($id: ID!) {
    adminInquiry(id: $id) {
      ${ADMIN_INQUIRY_FIELDS}
    }
  }
`;

export const ADMIN_UNHANDLED_INQUIRY_COUNT = /* GraphQL */ `
  query AdminUnhandledInquiryCount {
    adminUnhandledInquiryCount
  }
`;

export const ADMIN_INQUIRY_CATEGORIES = /* GraphQL */ `
  query AdminInquiryCategories {
    adminInquiryCategories {
      ${CATEGORY_FIELDS}
      linkedCount
    }
  }
`;

export const REPLY_TO_INQUIRY = /* GraphQL */ `
  mutation AdminReplyToInquiry(
    $inquiryId: ID!
    $body: String!
    $reason: String
  ) {
    replyToInquiry(inquiryId: $inquiryId, body: $body, reason: $reason) {
      message {
        ${MESSAGE_FIELDS}
      }
      notificationQueued
    }
  }
`;

export const CHANGE_INQUIRY_STATUS = /* GraphQL */ `
  mutation AdminChangeInquiryStatus(
    $inquiryId: ID!
    $status: InquiryStatus!
    $reason: String
  ) {
    changeInquiryStatus(
      inquiryId: $inquiryId
      status: $status
      reason: $reason
    ) {
      ${ADMIN_INQUIRY_FIELDS}
    }
  }
`;

export const CREATE_INQUIRY_CATEGORY = /* GraphQL */ `
  mutation AdminCreateInquiryCategory($name: String!, $reason: String) {
    createInquiryCategory(name: $name, reason: $reason) {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const RENAME_INQUIRY_CATEGORY = /* GraphQL */ `
  mutation AdminRenameInquiryCategory(
    $id: ID!
    $name: String!
    $reason: String
  ) {
    renameInquiryCategory(id: $id, name: $name, reason: $reason) {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const DELETE_INQUIRY_CATEGORY = /* GraphQL */ `
  mutation AdminDeleteInquiryCategory($id: ID!, $reason: String) {
    deleteInquiryCategory(id: $id, reason: $reason)
  }
`;

export interface ReplyNotificationOutbox {
  readonly sent: InquiryReplyNotification[];
  failing: boolean;
}

// 返信の通知メールの送信要求を記録し、failingが真なら失敗させる偽物
export const replyNotificationOutbox: ReplyNotificationOutbox = {
  sent: [],
  failing: false,
};

const recordingInquiryMailer: InquiryMailer = {
  sendReplyNotification: (notification) => {
    if (replyNotificationOutbox.failing) {
      return Promise.reject(new Error('メールの送信要求に失敗しました'));
    }
    replyNotificationOutbox.sent.push(notification);
    return Promise.resolve();
  },
};

const RECORDING_INQUIRY_MAILER_MODULE: AppModule<GatewayApp> = {
  name: 'inquiry-graphql-test-mailer',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<InquiryMailer>(INQUIRY_TYPES.InquiryMailer).toConstantValue(
      recordingInquiryMailer,
    );
  }),
};

export const inquiryAdminGateway = createAdminGateway({
  documents: [
    ADMIN_INQUIRIES,
    ADMIN_INQUIRY,
    ADMIN_UNHANDLED_INQUIRY_COUNT,
    ADMIN_INQUIRY_CATEGORIES,
    REPLY_TO_INQUIRY,
    CHANGE_INQUIRY_STATUS,
    CREATE_INQUIRY_CATEGORY,
    RENAME_INQUIRY_CATEGORY,
    DELETE_INQUIRY_CATEGORY,
  ],
  schemaModules: [mediaSchemaModule, inquirySchemaModule],
  overrides: [RECORDING_INQUIRY_MAILER_MODULE],
});

// 返信した管理者の照会に使う番号と重ならないよう、操作する管理者は別の番号にする
export const INQUIRY_ADMINS = Object.freeze({
  superAdmin: 11,
  moderator: 12,
  viewer: 13,
});

export type InquiryAdminIndex =
  (typeof INQUIRY_ADMINS)[keyof typeof INQUIRY_ADMINS];

const ROLES_OF_INQUIRY_ADMINS: readonly (readonly [
  InquiryAdminIndex,
  AdminRole,
])[] = [
  [INQUIRY_ADMINS.superAdmin, 'super_admin'],
  [INQUIRY_ADMINS.moderator, 'moderator'],
  [INQUIRY_ADMINS.viewer, 'viewer'],
];

const adminSessionTokens = new Map<number, string>();

export function inquiryAdminSessionOf(adminIndex: number): string {
  const token = adminSessionTokens.get(adminIndex);
  if (token === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return token;
}

export function inquiryAdminIdOf(adminIndex: InquiryAdminIndex): string {
  return adminIdOf(adminIndex);
}

// 問い合わせのテストの用意に加え、3つのロールの管理者とそのセッションを用意し、通知メールの偽物を空に戻す
export function installInquiryAdminGraphQLTest(): InquiryTestContext {
  const context = installInquiryGraphQLTest();

  beforeEach(async () => {
    replyNotificationOutbox.sent.splice(0);
    replyNotificationOutbox.failing = false;
    adminSessionTokens.clear();
    for (const [index, role] of ROLES_OF_INQUIRY_ADMINS) {
      await insertAdmin(index, { role, nickname: `運営${String(index)}` });
      adminSessionTokens.set(
        index,
        (await issueAdminSession(adminIdOf(index))).token,
      );
    }
  });

  return context;
}

const asAdmin = (adminIndex: number): GatewayCallOptions => ({
  sessionToken: inquiryAdminSessionOf(adminIndex),
});

export function fetchAdminInquiries(
  adminIndex: number,
  variables: { readonly filter?: unknown; readonly after?: string | null } = {},
) {
  return inquiryAdminGateway.call<{
    adminInquiries: {
      entries: AdminInquirySummaryFields[];
      nextCursor: string | null;
    } | null;
  }>(ADMIN_INQUIRIES, { ...variables }, asAdmin(adminIndex));
}

export function fetchAdminInquiry(adminIndex: number, id: string) {
  return inquiryAdminGateway.call<{
    adminInquiry: AdminInquiryFields | null;
  }>(ADMIN_INQUIRY, { id }, asAdmin(adminIndex));
}

export function fetchAdminUnhandledInquiryCount(adminIndex: number) {
  return inquiryAdminGateway.call<{
    adminUnhandledInquiryCount: number | null;
  }>(ADMIN_UNHANDLED_INQUIRY_COUNT, {}, asAdmin(adminIndex));
}

export function fetchAdminInquiryCategories(adminIndex: number) {
  return inquiryAdminGateway.call<{
    adminInquiryCategories: AdminInquiryCategoryFields[] | null;
  }>(ADMIN_INQUIRY_CATEGORIES, {}, asAdmin(adminIndex));
}

export function replyToInquiry(
  adminIndex: number,
  variables: {
    readonly inquiryId: string;
    readonly body: string;
    readonly reason?: string;
  },
) {
  return inquiryAdminGateway.call<{
    replyToInquiry: {
      message: InquiryMessageFields;
      notificationQueued: boolean;
    } | null;
  }>(REPLY_TO_INQUIRY, { ...variables }, asAdmin(adminIndex));
}

export function changeInquiryStatus(
  adminIndex: number,
  variables: {
    readonly inquiryId: string;
    readonly status: string;
    readonly reason?: string;
  },
) {
  return inquiryAdminGateway.call<{
    changeInquiryStatus: AdminInquiryFields | null;
  }>(CHANGE_INQUIRY_STATUS, { ...variables }, asAdmin(adminIndex));
}

export function createInquiryCategory(
  adminIndex: number,
  variables: { readonly name: string; readonly reason?: string },
) {
  return inquiryAdminGateway.call<{
    createInquiryCategory: InquiryCategoryFields | null;
  }>(CREATE_INQUIRY_CATEGORY, { ...variables }, asAdmin(adminIndex));
}

export function renameInquiryCategory(
  adminIndex: number,
  variables: {
    readonly id: string;
    readonly name: string;
    readonly reason?: string;
  },
) {
  return inquiryAdminGateway.call<{
    renameInquiryCategory: InquiryCategoryFields | null;
  }>(RENAME_INQUIRY_CATEGORY, { ...variables }, asAdmin(adminIndex));
}

export function deleteInquiryCategory(
  adminIndex: number,
  variables: { readonly id: string; readonly reason?: string },
) {
  return inquiryAdminGateway.call<{
    deleteInquiryCategory: boolean | null;
  }>(DELETE_INQUIRY_CATEGORY, { ...variables }, asAdmin(adminIndex));
}
