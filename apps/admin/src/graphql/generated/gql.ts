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
    "query AdminAccounts {\n  adminAccounts {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": typeof types.AdminAccountsDocument,
    "mutation AdminChangeRole($id: ID!, $role: AdminRole!, $reason: String) {\n  changeAdminRole(id: $id, role: $role, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": typeof types.AdminChangeRoleDocument,
    "mutation AdminDelete($id: ID!, $reason: String) {\n  deleteAdmin(id: $id, reason: $reason)\n}": typeof types.AdminDeleteDocument,
    "mutation AdminInvite($email: String!, $reason: String) {\n  inviteAdmin(email: $email, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": typeof types.AdminInviteDocument,
    "mutation AdminResendInvitation($id: ID!, $reason: String) {\n  resendAdminInvitation(id: $id, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": typeof types.AdminResendInvitationDocument,
    "mutation AdminUpdateProfile($id: ID!, $nickname: String!, $title: String, $avatarFileId: ID) {\n  updateAdminProfile(\n    id: $id\n    nickname: $nickname\n    title: $title\n    avatarFileId: $avatarFileId\n  ) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": typeof types.AdminUpdateProfileDocument,
    "query AdminAuditLogs($filter: AuditLogFilterInput, $after: String) {\n  auditLogs(filter: $filter, after: $after) {\n    entries {\n      id\n      occurredAt\n      operator {\n        id\n        nickname\n      }\n      action\n      actionLabel\n      targetKind\n      targetIds\n      reason\n      detail {\n        key\n        value\n      }\n    }\n    nextCursor\n  }\n}": typeof types.AdminAuditLogsDocument,
    "mutation AdminCompleteInvitation($token: String!, $totpCode: String!) {\n  completeAdminInvitation(token: $token, totpCode: $totpCode) {\n    codes\n  }\n}": typeof types.AdminCompleteInvitationDocument,
    "mutation AdminCompleteSecondFactorLogin($challenge: String!, $secondFactor: AdminSecondFactorInput!) {\n  completeAdminSecondFactorLogin(\n    challenge: $challenge\n    secondFactor: $secondFactor\n  ) {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}": typeof types.AdminCompleteSecondFactorLoginDocument,
    "mutation AdminConfirmEmailChange($token: String!) {\n  confirmAdminEmailChange(token: $token) {\n    viewer {\n      id\n      nickname\n      title\n      email\n      role\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      remainingRecoveryCodes\n    }\n  }\n}": typeof types.AdminConfirmEmailChangeDocument,
    "mutation AdminLogin($email: String!, $password: String!) {\n  adminLogin(email: $email, password: $password) {\n    challenge\n    expiresAt\n  }\n}": typeof types.AdminLoginDocument,
    "mutation AdminLogout {\n  adminLogout\n}": typeof types.AdminLogoutDocument,
    "mutation AdminRequestPasswordReset($email: String!) {\n  requestAdminPasswordReset(email: $email)\n}": typeof types.AdminRequestPasswordResetDocument,
    "mutation AdminResetPassword($token: String!, $newPassword: String!) {\n  resetAdminPassword(token: $token, newPassword: $newPassword)\n}": typeof types.AdminResetPasswordDocument,
    "mutation AdminStartInvitation($token: String!, $nickname: String!, $password: String!) {\n  startAdminInvitation(token: $token, nickname: $nickname, password: $password) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": typeof types.AdminStartInvitationDocument,
    "mutation AdminChangePassword($newPassword: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  changeAdminPassword(\n    newPassword: $newPassword\n    reAuthentication: $reAuthentication\n  )\n}": typeof types.AdminChangePasswordDocument,
    "mutation AdminCompleteTotpReset($totpCode: String!) {\n  completeAdminTotpReset(totpCode: $totpCode) {\n    codes\n  }\n}": typeof types.AdminCompleteTotpResetDocument,
    "mutation AdminRegenerateRecoveryCodes($reAuthentication: AdminReAuthenticationInput!) {\n  regenerateAdminRecoveryCodes(reAuthentication: $reAuthentication) {\n    codes\n  }\n}": typeof types.AdminRegenerateRecoveryCodesDocument,
    "mutation AdminRequestEmailChange($newEmail: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  requestAdminEmailChange(\n    newEmail: $newEmail\n    reAuthentication: $reAuthentication\n  )\n}": typeof types.AdminRequestEmailChangeDocument,
    "mutation AdminStartTotpReset($reAuthentication: AdminReAuthenticationInput!) {\n  startAdminTotpReset(reAuthentication: $reAuthentication) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": typeof types.AdminStartTotpResetDocument,
    "query AdminViewer {\n  adminViewer {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}": typeof types.AdminViewerDocument,
    "query AdminSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": typeof types.AdminSystemStatusDocument,
};
const documents: Documents = {
    "query AdminAccounts {\n  adminAccounts {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": types.AdminAccountsDocument,
    "mutation AdminChangeRole($id: ID!, $role: AdminRole!, $reason: String) {\n  changeAdminRole(id: $id, role: $role, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": types.AdminChangeRoleDocument,
    "mutation AdminDelete($id: ID!, $reason: String) {\n  deleteAdmin(id: $id, reason: $reason)\n}": types.AdminDeleteDocument,
    "mutation AdminInvite($email: String!, $reason: String) {\n  inviteAdmin(email: $email, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": types.AdminInviteDocument,
    "mutation AdminResendInvitation($id: ID!, $reason: String) {\n  resendAdminInvitation(id: $id, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": types.AdminResendInvitationDocument,
    "mutation AdminUpdateProfile($id: ID!, $nickname: String!, $title: String, $avatarFileId: ID) {\n  updateAdminProfile(\n    id: $id\n    nickname: $nickname\n    title: $title\n    avatarFileId: $avatarFileId\n  ) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}": types.AdminUpdateProfileDocument,
    "query AdminAuditLogs($filter: AuditLogFilterInput, $after: String) {\n  auditLogs(filter: $filter, after: $after) {\n    entries {\n      id\n      occurredAt\n      operator {\n        id\n        nickname\n      }\n      action\n      actionLabel\n      targetKind\n      targetIds\n      reason\n      detail {\n        key\n        value\n      }\n    }\n    nextCursor\n  }\n}": types.AdminAuditLogsDocument,
    "mutation AdminCompleteInvitation($token: String!, $totpCode: String!) {\n  completeAdminInvitation(token: $token, totpCode: $totpCode) {\n    codes\n  }\n}": types.AdminCompleteInvitationDocument,
    "mutation AdminCompleteSecondFactorLogin($challenge: String!, $secondFactor: AdminSecondFactorInput!) {\n  completeAdminSecondFactorLogin(\n    challenge: $challenge\n    secondFactor: $secondFactor\n  ) {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}": types.AdminCompleteSecondFactorLoginDocument,
    "mutation AdminConfirmEmailChange($token: String!) {\n  confirmAdminEmailChange(token: $token) {\n    viewer {\n      id\n      nickname\n      title\n      email\n      role\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      remainingRecoveryCodes\n    }\n  }\n}": types.AdminConfirmEmailChangeDocument,
    "mutation AdminLogin($email: String!, $password: String!) {\n  adminLogin(email: $email, password: $password) {\n    challenge\n    expiresAt\n  }\n}": types.AdminLoginDocument,
    "mutation AdminLogout {\n  adminLogout\n}": types.AdminLogoutDocument,
    "mutation AdminRequestPasswordReset($email: String!) {\n  requestAdminPasswordReset(email: $email)\n}": types.AdminRequestPasswordResetDocument,
    "mutation AdminResetPassword($token: String!, $newPassword: String!) {\n  resetAdminPassword(token: $token, newPassword: $newPassword)\n}": types.AdminResetPasswordDocument,
    "mutation AdminStartInvitation($token: String!, $nickname: String!, $password: String!) {\n  startAdminInvitation(token: $token, nickname: $nickname, password: $password) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": types.AdminStartInvitationDocument,
    "mutation AdminChangePassword($newPassword: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  changeAdminPassword(\n    newPassword: $newPassword\n    reAuthentication: $reAuthentication\n  )\n}": types.AdminChangePasswordDocument,
    "mutation AdminCompleteTotpReset($totpCode: String!) {\n  completeAdminTotpReset(totpCode: $totpCode) {\n    codes\n  }\n}": types.AdminCompleteTotpResetDocument,
    "mutation AdminRegenerateRecoveryCodes($reAuthentication: AdminReAuthenticationInput!) {\n  regenerateAdminRecoveryCodes(reAuthentication: $reAuthentication) {\n    codes\n  }\n}": types.AdminRegenerateRecoveryCodesDocument,
    "mutation AdminRequestEmailChange($newEmail: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  requestAdminEmailChange(\n    newEmail: $newEmail\n    reAuthentication: $reAuthentication\n  )\n}": types.AdminRequestEmailChangeDocument,
    "mutation AdminStartTotpReset($reAuthentication: AdminReAuthenticationInput!) {\n  startAdminTotpReset(reAuthentication: $reAuthentication) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}": types.AdminStartTotpResetDocument,
    "query AdminViewer {\n  adminViewer {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}": types.AdminViewerDocument,
    "query AdminSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": types.AdminSystemStatusDocument,
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
export function graphql(source: "query AdminAccounts {\n  adminAccounts {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"): (typeof documents)["query AdminAccounts {\n  adminAccounts {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminChangeRole($id: ID!, $role: AdminRole!, $reason: String) {\n  changeAdminRole(id: $id, role: $role, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"): (typeof documents)["mutation AdminChangeRole($id: ID!, $role: AdminRole!, $reason: String) {\n  changeAdminRole(id: $id, role: $role, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminDelete($id: ID!, $reason: String) {\n  deleteAdmin(id: $id, reason: $reason)\n}"): (typeof documents)["mutation AdminDelete($id: ID!, $reason: String) {\n  deleteAdmin(id: $id, reason: $reason)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminInvite($email: String!, $reason: String) {\n  inviteAdmin(email: $email, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"): (typeof documents)["mutation AdminInvite($email: String!, $reason: String) {\n  inviteAdmin(email: $email, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminResendInvitation($id: ID!, $reason: String) {\n  resendAdminInvitation(id: $id, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"): (typeof documents)["mutation AdminResendInvitation($id: ID!, $reason: String) {\n  resendAdminInvitation(id: $id, reason: $reason) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminUpdateProfile($id: ID!, $nickname: String!, $title: String, $avatarFileId: ID) {\n  updateAdminProfile(\n    id: $id\n    nickname: $nickname\n    title: $title\n    avatarFileId: $avatarFileId\n  ) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"): (typeof documents)["mutation AdminUpdateProfile($id: ID!, $nickname: String!, $title: String, $avatarFileId: ID) {\n  updateAdminProfile(\n    id: $id\n    nickname: $nickname\n    title: $title\n    avatarFileId: $avatarFileId\n  ) {\n    id\n    email\n    nickname\n    title\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    role\n    status\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query AdminAuditLogs($filter: AuditLogFilterInput, $after: String) {\n  auditLogs(filter: $filter, after: $after) {\n    entries {\n      id\n      occurredAt\n      operator {\n        id\n        nickname\n      }\n      action\n      actionLabel\n      targetKind\n      targetIds\n      reason\n      detail {\n        key\n        value\n      }\n    }\n    nextCursor\n  }\n}"): (typeof documents)["query AdminAuditLogs($filter: AuditLogFilterInput, $after: String) {\n  auditLogs(filter: $filter, after: $after) {\n    entries {\n      id\n      occurredAt\n      operator {\n        id\n        nickname\n      }\n      action\n      actionLabel\n      targetKind\n      targetIds\n      reason\n      detail {\n        key\n        value\n      }\n    }\n    nextCursor\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminCompleteInvitation($token: String!, $totpCode: String!) {\n  completeAdminInvitation(token: $token, totpCode: $totpCode) {\n    codes\n  }\n}"): (typeof documents)["mutation AdminCompleteInvitation($token: String!, $totpCode: String!) {\n  completeAdminInvitation(token: $token, totpCode: $totpCode) {\n    codes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminCompleteSecondFactorLogin($challenge: String!, $secondFactor: AdminSecondFactorInput!) {\n  completeAdminSecondFactorLogin(\n    challenge: $challenge\n    secondFactor: $secondFactor\n  ) {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}"): (typeof documents)["mutation AdminCompleteSecondFactorLogin($challenge: String!, $secondFactor: AdminSecondFactorInput!) {\n  completeAdminSecondFactorLogin(\n    challenge: $challenge\n    secondFactor: $secondFactor\n  ) {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminConfirmEmailChange($token: String!) {\n  confirmAdminEmailChange(token: $token) {\n    viewer {\n      id\n      nickname\n      title\n      email\n      role\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      remainingRecoveryCodes\n    }\n  }\n}"): (typeof documents)["mutation AdminConfirmEmailChange($token: String!) {\n  confirmAdminEmailChange(token: $token) {\n    viewer {\n      id\n      nickname\n      title\n      email\n      role\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      remainingRecoveryCodes\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminLogin($email: String!, $password: String!) {\n  adminLogin(email: $email, password: $password) {\n    challenge\n    expiresAt\n  }\n}"): (typeof documents)["mutation AdminLogin($email: String!, $password: String!) {\n  adminLogin(email: $email, password: $password) {\n    challenge\n    expiresAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminLogout {\n  adminLogout\n}"): (typeof documents)["mutation AdminLogout {\n  adminLogout\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminRequestPasswordReset($email: String!) {\n  requestAdminPasswordReset(email: $email)\n}"): (typeof documents)["mutation AdminRequestPasswordReset($email: String!) {\n  requestAdminPasswordReset(email: $email)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminResetPassword($token: String!, $newPassword: String!) {\n  resetAdminPassword(token: $token, newPassword: $newPassword)\n}"): (typeof documents)["mutation AdminResetPassword($token: String!, $newPassword: String!) {\n  resetAdminPassword(token: $token, newPassword: $newPassword)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminStartInvitation($token: String!, $nickname: String!, $password: String!) {\n  startAdminInvitation(token: $token, nickname: $nickname, password: $password) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"): (typeof documents)["mutation AdminStartInvitation($token: String!, $nickname: String!, $password: String!) {\n  startAdminInvitation(token: $token, nickname: $nickname, password: $password) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminChangePassword($newPassword: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  changeAdminPassword(\n    newPassword: $newPassword\n    reAuthentication: $reAuthentication\n  )\n}"): (typeof documents)["mutation AdminChangePassword($newPassword: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  changeAdminPassword(\n    newPassword: $newPassword\n    reAuthentication: $reAuthentication\n  )\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminCompleteTotpReset($totpCode: String!) {\n  completeAdminTotpReset(totpCode: $totpCode) {\n    codes\n  }\n}"): (typeof documents)["mutation AdminCompleteTotpReset($totpCode: String!) {\n  completeAdminTotpReset(totpCode: $totpCode) {\n    codes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminRegenerateRecoveryCodes($reAuthentication: AdminReAuthenticationInput!) {\n  regenerateAdminRecoveryCodes(reAuthentication: $reAuthentication) {\n    codes\n  }\n}"): (typeof documents)["mutation AdminRegenerateRecoveryCodes($reAuthentication: AdminReAuthenticationInput!) {\n  regenerateAdminRecoveryCodes(reAuthentication: $reAuthentication) {\n    codes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminRequestEmailChange($newEmail: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  requestAdminEmailChange(\n    newEmail: $newEmail\n    reAuthentication: $reAuthentication\n  )\n}"): (typeof documents)["mutation AdminRequestEmailChange($newEmail: String!, $reAuthentication: AdminReAuthenticationInput!) {\n  requestAdminEmailChange(\n    newEmail: $newEmail\n    reAuthentication: $reAuthentication\n  )\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AdminStartTotpReset($reAuthentication: AdminReAuthenticationInput!) {\n  startAdminTotpReset(reAuthentication: $reAuthentication) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"): (typeof documents)["mutation AdminStartTotpReset($reAuthentication: AdminReAuthenticationInput!) {\n  startAdminTotpReset(reAuthentication: $reAuthentication) {\n    otpauthUri\n    secret\n    expiresAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query AdminViewer {\n  adminViewer {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}"): (typeof documents)["query AdminViewer {\n  adminViewer {\n    id\n    nickname\n    title\n    email\n    role\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    remainingRecoveryCodes\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query AdminSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"): (typeof documents)["query AdminSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;