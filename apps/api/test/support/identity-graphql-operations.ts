import { resetSync } from '@logtape/logtape';
import { Secret, TOTP } from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

import { clearIdentityTables } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  botTokenFor,
  type CallOptions,
  createIdentityGateway,
  type IdentityGateway,
  type IdentityResponse,
  sentMails,
  uniqueEmail,
} from './identity-graphql-harness.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface ViewerFields {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly totpEnabled: boolean;
  readonly remainingRecoveryCodes: number;
}

export type LoginResultFields =
  | { readonly __typename: 'LoginSucceeded'; readonly viewer: ViewerFields }
  | {
      readonly __typename: 'SecondFactorRequired';
      readonly challenge: string;
      readonly expiresAt: string;
    };

export interface RegisteredUser {
  readonly viewer: ViewerFields;
  readonly email: string;
  readonly sessionToken: string;
}

const VIEWER_FIELDS = /* GraphQL */ `
  id
  handle
  nickname
  email
  emailVerified
  status
  totpEnabled
  remainingRecoveryCodes
`;

export const REGISTER_USER = /* GraphQL */ `
  mutation ClientRegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      ${VIEWER_FIELDS}
    }
  }
`;

export const LOGIN = /* GraphQL */ `
  mutation ClientLogin($input: LoginInput!) {
    login(input: $input) {
      __typename
      ... on LoginSucceeded {
        viewer {
          ${VIEWER_FIELDS}
        }
      }
      ... on SecondFactorRequired {
        challenge
        expiresAt
      }
    }
  }
`;

export const COMPLETE_SECOND_FACTOR_LOGIN = /* GraphQL */ `
  mutation ClientCompleteSecondFactorLogin(
    $input: CompleteSecondFactorLoginInput!
  ) {
    completeSecondFactorLogin(input: $input) {
      ${VIEWER_FIELDS}
    }
  }
`;

export const LOGOUT = /* GraphQL */ `
  mutation ClientLogout {
    logout
  }
`;

export const VIEWER = /* GraphQL */ `
  query ClientViewer {
    viewer {
      ${VIEWER_FIELDS}
    }
  }
`;

export const VIEWER_HEADER = /* GraphQL */ `
  query ClientViewerHeader {
    viewer {
      id
      nickname
    }
  }
`;

export const RESEND_VERIFICATION_EMAIL = /* GraphQL */ `
  mutation ClientResendVerificationEmail {
    resendVerificationEmail
  }
`;

export const VERIFY_EMAIL = /* GraphQL */ `
  mutation ClientVerifyEmail($token: String!) {
    verifyEmail(token: $token)
  }
`;

export const REQUEST_PASSWORD_RESET = /* GraphQL */ `
  mutation ClientRequestPasswordReset($email: String!) {
    requestPasswordReset(email: $email)
  }
`;

export const RESET_PASSWORD = /* GraphQL */ `
  mutation ClientResetPassword($input: ResetPasswordInput!) {
    resetPassword(input: $input)
  }
`;

export const REQUEST_EMAIL_CHANGE = /* GraphQL */ `
  mutation ClientRequestEmailChange($input: RequestEmailChangeInput!) {
    requestEmailChange(input: $input)
  }
`;

export const CONFIRM_EMAIL_CHANGE = /* GraphQL */ `
  mutation ClientConfirmEmailChange($token: String!) {
    confirmEmailChange(token: $token) {
      viewer {
        ${VIEWER_FIELDS}
      }
    }
  }
`;

export const REQUEST_PASSWORD_CHANGE = /* GraphQL */ `
  mutation ClientRequestPasswordChange($input: RequestPasswordChangeInput!) {
    requestPasswordChange(input: $input)
  }
`;

export const CONFIRM_PASSWORD_CHANGE = /* GraphQL */ `
  mutation ClientConfirmPasswordChange($token: String!) {
    confirmPasswordChange(token: $token) {
      viewer {
        ${VIEWER_FIELDS}
      }
    }
  }
`;

export const WITHDRAW = /* GraphQL */ `
  mutation ClientWithdraw($input: ReAuthenticationInput!) {
    withdraw(input: $input)
  }
`;

export const MY_SESSIONS = /* GraphQL */ `
  query ClientMySessions {
    mySessions {
      id
      browserName
      osName
      createdAt
      lastUsedAt
      current
    }
  }
`;

export const REVOKE_SESSION = /* GraphQL */ `
  mutation ClientRevokeSession($id: ID!) {
    revokeSession(id: $id)
  }
`;

export const REVOKE_OTHER_SESSIONS = /* GraphQL */ `
  mutation ClientRevokeOtherSessions {
    revokeOtherSessions
  }
`;

export const START_TOTP_SETUP = /* GraphQL */ `
  mutation ClientStartTotpSetup($input: ReAuthenticationInput!) {
    startTotpSetup(input: $input) {
      otpauthUri
      secret
      expiresAt
    }
  }
`;

export const ENABLE_TOTP = /* GraphQL */ `
  mutation ClientEnableTotp($totpCode: String!) {
    enableTotp(totpCode: $totpCode) {
      codes
    }
  }
`;

export const DISABLE_TOTP = /* GraphQL */ `
  mutation ClientDisableTotp($input: ReAuthenticationInput!) {
    disableTotp(input: $input)
  }
`;

export const REGENERATE_RECOVERY_CODES = /* GraphQL */ `
  mutation ClientRegenerateRecoveryCodes($input: ReAuthenticationInput!) {
    regenerateRecoveryCodes(input: $input) {
      codes
    }
  }
`;

export const SECURITY_OPERATIONS: readonly string[] = [
  REQUEST_EMAIL_CHANGE,
  CONFIRM_EMAIL_CHANGE,
  REQUEST_PASSWORD_CHANGE,
  CONFIRM_PASSWORD_CHANGE,
  WITHDRAW,
  MY_SESSIONS,
  REVOKE_SESSION,
  REVOKE_OTHER_SESSIONS,
  START_TOTP_SETUP,
  ENABLE_TOTP,
  DISABLE_TOTP,
  REGENERATE_RECOVERY_CODES,
];

export const ACCOUNT_OPERATIONS: readonly string[] = [
  REGISTER_USER,
  LOGIN,
  COMPLETE_SECOND_FACTOR_LOGIN,
  LOGOUT,
  VIEWER,
  VIEWER_HEADER,
  RESEND_VERIFICATION_EMAIL,
  VERIFY_EMAIL,
  REQUEST_PASSWORD_RESET,
  RESET_PASSWORD,
];

export const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

export const NEW_PASSWORD = ['purple', 'monkey', 'dishwasher', 'nine'].join(
  ' ',
);

export const WRONG_PASSWORD = ['wrong', 'horse', 'battery', 'staple'].join(' ');

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function codesOf(response: IdentityResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: IdentityResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function registrationInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nickname: 'ローンチ太郎',
    email: uniqueEmail('register'),
    password: PASSWORD,
    agreedToTerms: true,
    ...overrides,
  };
}

export async function register(
  gateway: IdentityGateway,
  overrides: Record<string, unknown> = {},
): Promise<RegisteredUser> {
  const input = registrationInput(overrides);
  const response = await gateway.call<{ registerUser: ViewerFields }>(
    REGISTER_USER,
    { input },
    { botToken: botTokenFor('register') },
  );
  expect(response.errors).toBeUndefined();
  if (response.data == null || response.issuedToken === undefined) {
    throw new Error('登録できませんでした');
  }
  return {
    viewer: response.data.registerUser,
    email: String(input['email']),
    sessionToken: response.issuedToken,
  };
}

export function login(
  gateway: IdentityGateway,
  email: string,
  password: string,
  options: CallOptions = {},
): Promise<IdentityResponse<{ login: LoginResultFields }>> {
  return gateway.call<{ login: LoginResultFields }>(
    LOGIN,
    { input: { email, password } },
    { botToken: botTokenFor('login'), ...options },
  );
}

export function fetchViewer(
  gateway: IdentityGateway,
  sessionToken: string | undefined,
): Promise<IdentityResponse<{ viewer: ViewerFields | null }>> {
  return gateway.call<{ viewer: ViewerFields | null }>(
    VIEWER,
    {},
    sessionToken === undefined ? {} : { sessionToken },
  );
}

export interface ConfirmationFields {
  readonly viewer: ViewerFields | null;
}

export interface RecoveryCodeSetFields {
  readonly codes: readonly string[];
}

export function reAuthenticationInput(
  currentPassword: string,
  secondFactor?: { readonly totpCode?: string; readonly recoveryCode?: string },
): Record<string, unknown> {
  return {
    currentPassword,
    ...(secondFactor !== undefined && { secondFactor }),
  };
}

export function currentTotpCode(secret: string, at = new Date()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at.getTime() });
}

export interface IdentityTestContext {
  readonly gateway: IdentityGateway;
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前に利用者のテーブル・送ったメール・ログの記録を空にし、外部サービスの偽物を戻す
export function installIdentityGraphQLTest(
  operations: readonly string[] = ACCOUNT_OPERATIONS,
): IdentityTestContext {
  const gateway = createIdentityGateway(operations);
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearIdentityTables();
    sentMails.splice(0);
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
