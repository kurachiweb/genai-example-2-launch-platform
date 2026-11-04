/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "mutation ClientCompleteSecondFactorLogin($input: CompleteSecondFactorLoginInput!) {\n  completeSecondFactorLogin(input: $input) {\n    id\n  }\n}": typeof types.ClientCompleteSecondFactorLoginDocument,
    "mutation ClientConfirmEmailChange($token: String!) {\n  confirmEmailChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}": typeof types.ClientConfirmEmailChangeDocument,
    "mutation ClientConfirmPasswordChange($token: String!) {\n  confirmPasswordChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}": typeof types.ClientConfirmPasswordChangeDocument,
    "mutation ClientDisableTotp($input: ReAuthenticationInput!) {\n  disableTotp(input: $input)\n}": typeof types.ClientDisableTotpDocument,
    "mutation ClientEnableTotp($totpCode: String!) {\n  enableTotp(totpCode: $totpCode) {\n    codes\n  }\n}": typeof types.ClientEnableTotpDocument,
    "mutation ClientLogin($input: LoginInput!) {\n  login(input: $input) {\n    __typename\n    ... on LoginSucceeded {\n      viewer {\n        id\n      }\n    }\n    ... on SecondFactorRequired {\n      challenge\n      expiresAt\n    }\n  }\n}": typeof types.ClientLoginDocument,
    "mutation ClientLogout {\n  logout\n}": typeof types.ClientLogoutDocument,
    "query ClientMySessions {\n  mySessions {\n    id\n    browserName\n    osName\n    createdAt\n    lastUsedAt\n    current\n  }\n  viewer {\n    id\n    totpEnabled\n    remainingRecoveryCodes\n  }\n}": typeof types.ClientMySessionsDocument,
    "mutation ClientRegenerateRecoveryCodes($input: ReAuthenticationInput!) {\n  regenerateRecoveryCodes(input: $input) {\n    codes\n  }\n}": typeof types.ClientRegenerateRecoveryCodesDocument,
    "mutation ClientRegisterUser($input: RegisterUserInput!) {\n  registerUser(input: $input) {\n    id\n  }\n}": typeof types.ClientRegisterUserDocument,
    "mutation ClientRequestEmailChange($input: RequestEmailChangeInput!) {\n  requestEmailChange(input: $input)\n}": typeof types.ClientRequestEmailChangeDocument,
    "mutation ClientRequestPasswordChange($input: RequestPasswordChangeInput!) {\n  requestPasswordChange(input: $input)\n}": typeof types.ClientRequestPasswordChangeDocument,
    "mutation ClientRequestPasswordReset($email: String!) {\n  requestPasswordReset(email: $email)\n}": typeof types.ClientRequestPasswordResetDocument,
    "mutation ClientResendVerificationEmail {\n  resendVerificationEmail\n}": typeof types.ClientResendVerificationEmailDocument,
    "mutation ClientResetPassword($input: ResetPasswordInput!) {\n  resetPassword(input: $input)\n}": typeof types.ClientResetPasswordDocument,
    "mutation ClientRevokeOtherSessions {\n  revokeOtherSessions\n}": typeof types.ClientRevokeOtherSessionsDocument,
    "mutation ClientRevokeSession($id: ID!) {\n  revokeSession(id: $id)\n}": typeof types.ClientRevokeSessionDocument,
    "mutation ClientStartTotpSetup($input: ReAuthenticationInput!) {\n  startTotpSetup(input: $input) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": typeof types.ClientStartTotpSetupDocument,
    "mutation ClientVerifyEmail($token: String!) {\n  verifyEmail(token: $token)\n}": typeof types.ClientVerifyEmailDocument,
    "query ClientViewer {\n  viewer {\n    id\n    handle\n    nickname\n    emailVerified\n    status\n    totpEnabled\n  }\n}": typeof types.ClientViewerDocument,
    "mutation ClientWithdraw($input: ReAuthenticationInput!) {\n  withdraw(input: $input)\n}": typeof types.ClientWithdrawDocument,
    "query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}": typeof types.ClientLegalDocumentVersionDocument,
    "query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}": typeof types.ClientLegalDocumentDocument,
    "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": typeof types.ClientSystemStatusDocument,
};
const documents: Documents = {
    "mutation ClientCompleteSecondFactorLogin($input: CompleteSecondFactorLoginInput!) {\n  completeSecondFactorLogin(input: $input) {\n    id\n  }\n}": types.ClientCompleteSecondFactorLoginDocument,
    "mutation ClientConfirmEmailChange($token: String!) {\n  confirmEmailChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}": types.ClientConfirmEmailChangeDocument,
    "mutation ClientConfirmPasswordChange($token: String!) {\n  confirmPasswordChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}": types.ClientConfirmPasswordChangeDocument,
    "mutation ClientDisableTotp($input: ReAuthenticationInput!) {\n  disableTotp(input: $input)\n}": types.ClientDisableTotpDocument,
    "mutation ClientEnableTotp($totpCode: String!) {\n  enableTotp(totpCode: $totpCode) {\n    codes\n  }\n}": types.ClientEnableTotpDocument,
    "mutation ClientLogin($input: LoginInput!) {\n  login(input: $input) {\n    __typename\n    ... on LoginSucceeded {\n      viewer {\n        id\n      }\n    }\n    ... on SecondFactorRequired {\n      challenge\n      expiresAt\n    }\n  }\n}": types.ClientLoginDocument,
    "mutation ClientLogout {\n  logout\n}": types.ClientLogoutDocument,
    "query ClientMySessions {\n  mySessions {\n    id\n    browserName\n    osName\n    createdAt\n    lastUsedAt\n    current\n  }\n  viewer {\n    id\n    totpEnabled\n    remainingRecoveryCodes\n  }\n}": types.ClientMySessionsDocument,
    "mutation ClientRegenerateRecoveryCodes($input: ReAuthenticationInput!) {\n  regenerateRecoveryCodes(input: $input) {\n    codes\n  }\n}": types.ClientRegenerateRecoveryCodesDocument,
    "mutation ClientRegisterUser($input: RegisterUserInput!) {\n  registerUser(input: $input) {\n    id\n  }\n}": types.ClientRegisterUserDocument,
    "mutation ClientRequestEmailChange($input: RequestEmailChangeInput!) {\n  requestEmailChange(input: $input)\n}": types.ClientRequestEmailChangeDocument,
    "mutation ClientRequestPasswordChange($input: RequestPasswordChangeInput!) {\n  requestPasswordChange(input: $input)\n}": types.ClientRequestPasswordChangeDocument,
    "mutation ClientRequestPasswordReset($email: String!) {\n  requestPasswordReset(email: $email)\n}": types.ClientRequestPasswordResetDocument,
    "mutation ClientResendVerificationEmail {\n  resendVerificationEmail\n}": types.ClientResendVerificationEmailDocument,
    "mutation ClientResetPassword($input: ResetPasswordInput!) {\n  resetPassword(input: $input)\n}": types.ClientResetPasswordDocument,
    "mutation ClientRevokeOtherSessions {\n  revokeOtherSessions\n}": types.ClientRevokeOtherSessionsDocument,
    "mutation ClientRevokeSession($id: ID!) {\n  revokeSession(id: $id)\n}": types.ClientRevokeSessionDocument,
    "mutation ClientStartTotpSetup($input: ReAuthenticationInput!) {\n  startTotpSetup(input: $input) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": types.ClientStartTotpSetupDocument,
    "mutation ClientVerifyEmail($token: String!) {\n  verifyEmail(token: $token)\n}": types.ClientVerifyEmailDocument,
    "query ClientViewer {\n  viewer {\n    id\n    handle\n    nickname\n    emailVerified\n    status\n    totpEnabled\n  }\n}": types.ClientViewerDocument,
    "mutation ClientWithdraw($input: ReAuthenticationInput!) {\n  withdraw(input: $input)\n}": types.ClientWithdrawDocument,
    "query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}": types.ClientLegalDocumentVersionDocument,
    "query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}": types.ClientLegalDocumentDocument,
    "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": types.ClientSystemStatusDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientCompleteSecondFactorLogin($input: CompleteSecondFactorLoginInput!) {\n  completeSecondFactorLogin(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ClientCompleteSecondFactorLogin($input: CompleteSecondFactorLoginInput!) {\n  completeSecondFactorLogin(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientConfirmEmailChange($token: String!) {\n  confirmEmailChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}"): (typeof documents)["mutation ClientConfirmEmailChange($token: String!) {\n  confirmEmailChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientConfirmPasswordChange($token: String!) {\n  confirmPasswordChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}"): (typeof documents)["mutation ClientConfirmPasswordChange($token: String!) {\n  confirmPasswordChange(token: $token) {\n    viewer {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientDisableTotp($input: ReAuthenticationInput!) {\n  disableTotp(input: $input)\n}"): (typeof documents)["mutation ClientDisableTotp($input: ReAuthenticationInput!) {\n  disableTotp(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientEnableTotp($totpCode: String!) {\n  enableTotp(totpCode: $totpCode) {\n    codes\n  }\n}"): (typeof documents)["mutation ClientEnableTotp($totpCode: String!) {\n  enableTotp(totpCode: $totpCode) {\n    codes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientLogin($input: LoginInput!) {\n  login(input: $input) {\n    __typename\n    ... on LoginSucceeded {\n      viewer {\n        id\n      }\n    }\n    ... on SecondFactorRequired {\n      challenge\n      expiresAt\n    }\n  }\n}"): (typeof documents)["mutation ClientLogin($input: LoginInput!) {\n  login(input: $input) {\n    __typename\n    ... on LoginSucceeded {\n      viewer {\n        id\n      }\n    }\n    ... on SecondFactorRequired {\n      challenge\n      expiresAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientLogout {\n  logout\n}"): (typeof documents)["mutation ClientLogout {\n  logout\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientMySessions {\n  mySessions {\n    id\n    browserName\n    osName\n    createdAt\n    lastUsedAt\n    current\n  }\n  viewer {\n    id\n    totpEnabled\n    remainingRecoveryCodes\n  }\n}"): (typeof documents)["query ClientMySessions {\n  mySessions {\n    id\n    browserName\n    osName\n    createdAt\n    lastUsedAt\n    current\n  }\n  viewer {\n    id\n    totpEnabled\n    remainingRecoveryCodes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRegenerateRecoveryCodes($input: ReAuthenticationInput!) {\n  regenerateRecoveryCodes(input: $input) {\n    codes\n  }\n}"): (typeof documents)["mutation ClientRegenerateRecoveryCodes($input: ReAuthenticationInput!) {\n  regenerateRecoveryCodes(input: $input) {\n    codes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRegisterUser($input: RegisterUserInput!) {\n  registerUser(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ClientRegisterUser($input: RegisterUserInput!) {\n  registerUser(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRequestEmailChange($input: RequestEmailChangeInput!) {\n  requestEmailChange(input: $input)\n}"): (typeof documents)["mutation ClientRequestEmailChange($input: RequestEmailChangeInput!) {\n  requestEmailChange(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRequestPasswordChange($input: RequestPasswordChangeInput!) {\n  requestPasswordChange(input: $input)\n}"): (typeof documents)["mutation ClientRequestPasswordChange($input: RequestPasswordChangeInput!) {\n  requestPasswordChange(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRequestPasswordReset($email: String!) {\n  requestPasswordReset(email: $email)\n}"): (typeof documents)["mutation ClientRequestPasswordReset($email: String!) {\n  requestPasswordReset(email: $email)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientResendVerificationEmail {\n  resendVerificationEmail\n}"): (typeof documents)["mutation ClientResendVerificationEmail {\n  resendVerificationEmail\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientResetPassword($input: ResetPasswordInput!) {\n  resetPassword(input: $input)\n}"): (typeof documents)["mutation ClientResetPassword($input: ResetPasswordInput!) {\n  resetPassword(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRevokeOtherSessions {\n  revokeOtherSessions\n}"): (typeof documents)["mutation ClientRevokeOtherSessions {\n  revokeOtherSessions\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRevokeSession($id: ID!) {\n  revokeSession(id: $id)\n}"): (typeof documents)["mutation ClientRevokeSession($id: ID!) {\n  revokeSession(id: $id)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientStartTotpSetup($input: ReAuthenticationInput!) {\n  startTotpSetup(input: $input) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"): (typeof documents)["mutation ClientStartTotpSetup($input: ReAuthenticationInput!) {\n  startTotpSetup(input: $input) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientVerifyEmail($token: String!) {\n  verifyEmail(token: $token)\n}"): (typeof documents)["mutation ClientVerifyEmail($token: String!) {\n  verifyEmail(token: $token)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientViewer {\n  viewer {\n    id\n    handle\n    nickname\n    emailVerified\n    status\n    totpEnabled\n  }\n}"): (typeof documents)["query ClientViewer {\n  viewer {\n    id\n    handle\n    nickname\n    emailVerified\n    status\n    totpEnabled\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientWithdraw($input: ReAuthenticationInput!) {\n  withdraw(input: $input)\n}"): (typeof documents)["mutation ClientWithdraw($input: ReAuthenticationInput!) {\n  withdraw(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}"): (typeof documents)["query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}"): (typeof documents)["query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"): (typeof documents)["query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;