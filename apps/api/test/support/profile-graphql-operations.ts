import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { users } from '../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../db/schema/profile/user-previous-handles.ts';
import { userProfileWebsites } from '../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../db/schema/profile/user-profiles.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearProfilePlatformTables } from '../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface ProfileWebsiteFields {
  readonly name: string | null;
  readonly url: string;
}

export interface MediaImageFields {
  readonly id: string;
  readonly objectKey: string | null;
}

export interface MyProfileFields {
  readonly nickname: string;
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatar: MediaImageFields | null;
  readonly websites: readonly ProfileWebsiteFields[];
  readonly suspended: boolean;
}

export interface PublicProfileFields {
  readonly __typename: 'PublicProfile';
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatar: MediaImageFields | null;
  readonly websites: readonly ProfileWebsiteFields[];
  readonly followerCount: number;
  readonly ultras: boolean;
  readonly suspended: boolean;
  readonly viewerRelation: 'OWNER' | 'FOLLOWING' | 'NOT_FOLLOWING' | 'GUEST';
}

export interface PublicProfileRedirectFields {
  readonly __typename: 'PublicProfileRedirect';
  readonly handle: string;
}

export type HandleAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';

const MY_PROFILE_FIELDS = /* GraphQL */ `
  nickname
  handle
  previousHandle
  headline
  bio
  avatar {
    id
    objectKey
  }
  websites {
    name
    url
  }
  suspended
`;

export const PUBLIC_PROFILE = /* GraphQL */ `
  query ClientPublicProfile($handle: String!) {
    publicProfile(handle: $handle) {
      __typename
      ... on PublicProfile {
        handle
        nickname
        headline
        bio
        avatar {
          id
          objectKey
        }
        websites {
          name
          url
        }
        followerCount
        ultras
        suspended
        viewerRelation
      }
      ... on PublicProfileRedirect {
        handle
      }
    }
  }
`;

export const MY_PROFILE = /* GraphQL */ `
  query ClientMyProfile {
    myProfile {
      ${MY_PROFILE_FIELDS}
    }
  }
`;

export const HANDLE_AVAILABILITY = /* GraphQL */ `
  query ClientHandleAvailability($handle: String!) {
    handleAvailability(handle: $handle)
  }
`;

export const UPDATE_MY_PROFILE = /* GraphQL */ `
  mutation ClientUpdateMyProfile($input: UpdateMyProfileInput!) {
    updateMyProfile(input: $input) {
      ${MY_PROFILE_FIELDS}
    }
  }
`;

const profileGateway = createGraphQLGateway({
  documents: [
    PUBLIC_PROFILE,
    MY_PROFILE,
    HANDLE_AVAILABILITY,
    UPDATE_MY_PROFILE,
  ],
  schemaModules: [mediaSchemaModule, profileSchemaModule],
});

export interface ProfileTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前にプロフィール・旧ハンドル・ファイル・利用者のテーブルとログの記録を空にし、外部サービスの偽物を戻す
export function installProfileGraphQLTest(): ProfileTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearMediaTables();
    await db.delete(userPreviousHandles);
    await clearProfilePlatformTables();
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

export async function suspendUser(userIndex: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended', suspendedAt: new Date() })
    .where(eq(users.id, userIdOf(userIndex)));
}

export async function readProfileRows(userIndex: number) {
  const userId = userIdOf(userIndex);
  return {
    profile: await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId)),
    websites: await db
      .select()
      .from(userProfileWebsites)
      .where(eq(userProfileWebsites.userId, userId)),
  };
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function updateInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nickname: '新しいニックネーム',
    handle: 'user1',
    expectedHandle: 'user1',
    headline: null,
    bio: null,
    avatarFileId: null,
    websites: [],
    ...overrides,
  };
}

export function fetchPublicProfile(
  handle: string,
  options?: GatewayCallOptions,
) {
  return profileGateway.call<{
    publicProfile: PublicProfileFields | PublicProfileRedirectFields | null;
  }>(PUBLIC_PROFILE, { handle }, options);
}

export function fetchMyProfile(options?: GatewayCallOptions) {
  return profileGateway.call<{ myProfile: MyProfileFields | null }>(
    MY_PROFILE,
    {},
    options,
  );
}

export function fetchHandleAvailability(
  handle: string,
  options?: GatewayCallOptions,
) {
  return profileGateway.call<{
    handleAvailability: HandleAvailabilityValue | null;
  }>(HANDLE_AVAILABILITY, { handle }, options);
}

export function updateMyProfile(
  input: Record<string, unknown>,
  options?: GatewayCallOptions,
) {
  return profileGateway.call<{ updateMyProfile: MyProfileFields | null }>(
    UPDATE_MY_PROFILE,
    { input },
    options,
  );
}
