import { resetSync } from '@logtape/logtape';
import { Secret, TOTP } from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { clearAdminTables } from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { adminSchemaModule } from '../../src/presentation/graphql/modules/admin/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import {
  createAdminGateway,
  RECORDING_ADMIN_MAILER_MODULE,
  sentAdminMails,
} from './admin-graphql-harness.ts';
import {
  botTokenFor,
  type GatewayCallOptions,
  type GatewayResponse,
  type GraphQLGateway,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface AdminViewerFields {
  readonly id: string;
  readonly nickname: string;
  readonly title: string | null;
  readonly email: string;
  readonly role: 'VIEWER' | 'MODERATOR' | 'SUPER_ADMIN';
  readonly avatar: { readonly id: string } | null;
  readonly remainingRecoveryCodes: number;
}

export interface AdminSecondFactorRequiredFields {
  readonly challenge: string;
  readonly expiresAt: string;
}

export interface AdminTotpSetupFields {
  readonly otpauthUri: string;
  readonly secret: string;
  readonly expiresAt: string;
}

const ADMIN_VIEWER_FIELDS = /* GraphQL */ `
  id
  nickname
  title
  email
  role
  avatar {
    id
  }
  remainingRecoveryCodes
`;

export const ADMIN_VIEWER = /* GraphQL */ `
  query AdminViewer {
    adminViewer {
      ${ADMIN_VIEWER_FIELDS}
    }
  }
`;

export const ADMIN_LOGIN = /* GraphQL */ `
  mutation AdminLogin($email: String!, $password: String!) {
    adminLogin(email: $email, password: $password) {
      challenge
      expiresAt
    }
  }
`;

export const COMPLETE_ADMIN_SECOND_FACTOR_LOGIN = /* GraphQL */ `
  mutation AdminCompleteSecondFactorLogin(
    $challenge: String!
    $secondFactor: AdminSecondFactorInput!
  ) {
    completeAdminSecondFactorLogin(
      challenge: $challenge
      secondFactor: $secondFactor
    ) {
      ${ADMIN_VIEWER_FIELDS}
    }
  }
`;

export const ADMIN_LOGOUT = /* GraphQL */ `
  mutation AdminLogout {
    adminLogout
  }
`;

export const REQUEST_ADMIN_PASSWORD_RESET = /* GraphQL */ `
  mutation AdminRequestPasswordReset($email: String!) {
    requestAdminPasswordReset(email: $email)
  }
`;

export const RESET_ADMIN_PASSWORD = /* GraphQL */ `
  mutation AdminResetPassword($token: String!, $newPassword: String!) {
    resetAdminPassword(token: $token, newPassword: $newPassword)
  }
`;

export const START_ADMIN_INVITATION = /* GraphQL */ `
  mutation AdminStartInvitation(
    $token: String!
    $nickname: String!
    $password: String!
  ) {
    startAdminInvitation(
      token: $token
      nickname: $nickname
      password: $password
    ) {
      otpauthUri
      secret
      expiresAt
    }
  }
`;

export const COMPLETE_ADMIN_INVITATION = /* GraphQL */ `
  mutation AdminCompleteInvitation($token: String!, $totpCode: String!) {
    completeAdminInvitation(token: $token, totpCode: $totpCode) {
      codes
    }
  }
`;

export const CONFIRM_ADMIN_EMAIL_CHANGE = /* GraphQL */ `
  mutation AdminConfirmEmailChange($token: String!) {
    confirmAdminEmailChange(token: $token) {
      viewer {
        ${ADMIN_VIEWER_FIELDS}
      }
    }
  }
`;

export const ADMIN_AUTH_OPERATIONS: readonly string[] = [
  ADMIN_VIEWER,
  ADMIN_LOGIN,
  COMPLETE_ADMIN_SECOND_FACTOR_LOGIN,
  ADMIN_LOGOUT,
  REQUEST_ADMIN_PASSWORD_RESET,
  RESET_ADMIN_PASSWORD,
  START_ADMIN_INVITATION,
  COMPLETE_ADMIN_INVITATION,
  CONFIRM_ADMIN_EMAIL_CHANGE,
];

export const ADMIN_PASSWORD = ['amber', 'falcon', 'river', 'lantern'].join(' ');

export const NEW_ADMIN_PASSWORD = ['quiet', 'meadow', 'copper', 'kite'].join(
  ' ',
);

export const WRONG_ADMIN_PASSWORD = ['amber', 'falcon', 'river', 'wrong'].join(
  ' ',
);

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const ADMIN_BOT_ACTION_NAMES = Object.freeze({
  login: 'admin_login',
  passwordReset: 'admin_password_reset',
});

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function uniqueAdminEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@mail.example`;
}

export function currentTotpCode(secret: string, at = new Date()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at.getTime() });
}

export function adminLogin(
  gateway: GraphQLGateway,
  email: string,
  password: string,
  options: GatewayCallOptions = {},
): Promise<
  GatewayResponse<{ adminLogin: AdminSecondFactorRequiredFields | null }>
> {
  return gateway.call<{ adminLogin: AdminSecondFactorRequiredFields | null }>(
    ADMIN_LOGIN,
    { email, password },
    { botToken: botTokenFor(ADMIN_BOT_ACTION_NAMES.login), ...options },
  );
}

export async function challengeOf(
  gateway: GraphQLGateway,
  email: string,
  password: string,
): Promise<string> {
  const response = await adminLogin(gateway, email, password);
  const challenge = response.data?.adminLogin?.challenge;
  if (challenge === undefined) {
    throw new Error('第2要素の待ちになりませんでした');
  }
  return challenge;
}

export function fetchAdminViewer(
  gateway: GraphQLGateway,
  sessionToken: string | undefined,
): Promise<GatewayResponse<{ adminViewer: AdminViewerFields | null }>> {
  return gateway.call<{ adminViewer: AdminViewerFields | null }>(
    ADMIN_VIEWER,
    {},
    sessionToken === undefined ? {} : { sessionToken },
  );
}

export interface AdminTestContext {
  readonly gateway: GraphQLGateway;
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前に管理者のテーブル・送ったメール・ログの記録を空にし、外部サービスの偽物を戻す
export function installAdminGraphQLTest(
  operations: readonly string[] = ADMIN_AUTH_OPERATIONS,
): AdminTestContext {
  const gateway = createAdminGateway({
    documents: operations,
    schemaModules: [mediaSchemaModule, adminSchemaModule],
    overrides: [RECORDING_ADMIN_MAILER_MODULE],
  });
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearAdminTables();
    sentAdminMails.splice(0);
    logs.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    resetSync();
  });

  return { gateway, logs: () => logs };
}
