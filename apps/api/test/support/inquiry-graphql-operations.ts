import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
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
  createGraphQLGateway,
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
