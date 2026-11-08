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
    "query ClientMemberInquiry($id: ID!) {\n  memberInquiry(id: $id) {\n    id\n    category {\n      id\n      name\n    }\n    status\n    createdAt\n    messages {\n      id\n      sender\n      body\n      attachments {\n        id\n        originalFileName\n        contentType\n        byteSize\n      }\n      admin {\n        nickname\n        avatar {\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n        deleted\n      }\n      createdAt\n    }\n    canPost\n  }\n}": typeof types.ClientMemberInquiryDocument,
    "mutation ClientPostInquiryMessage($inquiryId: ID!, $input: InquiryMessageInput!) {\n  postInquiryMessage(inquiryId: $inquiryId, input: $input) {\n    id\n  }\n}": typeof types.ClientPostInquiryMessageDocument,
    "query ClientInquiryContactForm {\n  inquiryCategories {\n    id\n    name\n  }\n  inquiryComposer {\n    nickname\n    avatar {\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n  }\n}": typeof types.ClientInquiryContactFormDocument,
    "query ClientMyInquiries($after: String) {\n  myInquiries(after: $after) {\n    items {\n      id\n      category {\n        id\n        name\n      }\n      status\n      createdAt\n      lastMessageAt\n    }\n    nextCursor\n  }\n}": typeof types.ClientMyInquiriesDocument,
    "mutation ClientSubmitGuestInquiry($input: GuestInquiryInput!) {\n  submitGuestInquiry(input: $input)\n}": typeof types.ClientSubmitGuestInquiryDocument,
    "mutation ClientSubmitMemberInquiry($input: MemberInquiryInput!) {\n  submitMemberInquiry(input: $input) {\n    id\n  }\n}": typeof types.ClientSubmitMemberInquiryDocument,
    "query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}": typeof types.ClientLegalDocumentVersionDocument,
    "query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}": typeof types.ClientLegalDocumentDocument,
    "query ClientCheckout($purchaseId: ID!) {\n  checkout(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}": typeof types.ClientCheckoutDocument,
    "mutation ClientConfirmCheckoutReturn($sessionId: String!) {\n  confirmCheckoutReturn(sessionId: $sessionId) {\n    checkout {\n      purchaseId\n      kind\n      status\n      rejectionReason\n      unitPrice {\n        amount\n        currency\n      }\n      quantity\n      total {\n        amount\n        currency\n      }\n      summary {\n        itemName\n        quantityLabel\n        serviceTiming\n        additionalNotes\n        isSubscription\n      }\n      acceptUntil\n      expiresAt\n      canRestart\n    }\n  }\n}": typeof types.ClientConfirmCheckoutReturnDocument,
    "query ClientPaymentHistory($first: Int, $after: String) {\n  paymentHistory(first: $first, after: $after) {\n    nodes {\n      id\n      kind\n      purpose\n      amount {\n        amount\n        currency\n      }\n      quantity\n      status\n      occurredAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": typeof types.ClientPaymentHistoryDocument,
    "mutation ClientRecordCheckoutConsent($purchaseId: ID!) {\n  recordCheckoutConsent(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}": typeof types.ClientRecordCheckoutConsentDocument,
    "mutation ClientStartSmokeCheckout {\n  startSmokeCheckout {\n    purchaseId\n  }\n}": typeof types.ClientStartSmokeCheckoutDocument,
    "mutation ClientFollowUser($handle: String!) {\n  followUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}": typeof types.ClientFollowUserDocument,
    "query ClientHandleAvailability($handle: String!) {\n  handleAvailability(handle: $handle)\n}": typeof types.ClientHandleAvailabilityDocument,
    "query ClientMyFollowers($first: Int!, $after: String) {\n  myFollowers(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": typeof types.ClientMyFollowersDocument,
    "query ClientMyFollowing($first: Int!, $after: String) {\n  myFollowing(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": typeof types.ClientMyFollowingDocument,
    "query ClientMyProfile {\n  myProfile {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}": typeof types.ClientMyProfileDocument,
    "query ClientPublicProfile($handle: String!) {\n  publicProfile(handle: $handle) {\n    __typename\n    ... on PublicProfile {\n      handle\n      nickname\n      headline\n      bio\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      websites {\n        name\n        url\n      }\n      followerCount\n      ultras\n      suspended\n      viewerRelation\n    }\n    ... on PublicProfileRedirect {\n      handle\n    }\n  }\n}": typeof types.ClientPublicProfileDocument,
    "mutation ClientUnfollowUser($handle: String!) {\n  unfollowUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}": typeof types.ClientUnfollowUserDocument,
    "mutation ClientUpdateMyProfile($input: UpdateMyProfileInput!) {\n  updateMyProfile(input: $input) {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}": typeof types.ClientUpdateMyProfileDocument,
    "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": typeof types.ClientSystemStatusDocument,
    "mutation ClientCreateUltrasPortalSession {\n  createUltrasPortalSession {\n    url\n  }\n}": typeof types.ClientCreateUltrasPortalSessionDocument,
    "mutation ClientStartUltrasCheckout {\n  startUltrasCheckout {\n    purchaseId\n  }\n}": typeof types.ClientStartUltrasCheckoutDocument,
    "query ClientUltrasOffer {\n  ultrasOffer {\n    price {\n      amount\n      currency\n    }\n    priceStale\n    promotionEnabled\n  }\n}": typeof types.ClientUltrasOfferDocument,
    "query ClientViewerUltras {\n  viewerUltras {\n    entitled\n    canOpenPortal\n    plan {\n      status\n      startedAt\n      currentPeriodEndsAt\n      canceledAt\n      benefitEndsAt\n    }\n  }\n}": typeof types.ClientViewerUltrasDocument,
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
    "query ClientMemberInquiry($id: ID!) {\n  memberInquiry(id: $id) {\n    id\n    category {\n      id\n      name\n    }\n    status\n    createdAt\n    messages {\n      id\n      sender\n      body\n      attachments {\n        id\n        originalFileName\n        contentType\n        byteSize\n      }\n      admin {\n        nickname\n        avatar {\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n        deleted\n      }\n      createdAt\n    }\n    canPost\n  }\n}": types.ClientMemberInquiryDocument,
    "mutation ClientPostInquiryMessage($inquiryId: ID!, $input: InquiryMessageInput!) {\n  postInquiryMessage(inquiryId: $inquiryId, input: $input) {\n    id\n  }\n}": types.ClientPostInquiryMessageDocument,
    "query ClientInquiryContactForm {\n  inquiryCategories {\n    id\n    name\n  }\n  inquiryComposer {\n    nickname\n    avatar {\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n  }\n}": types.ClientInquiryContactFormDocument,
    "query ClientMyInquiries($after: String) {\n  myInquiries(after: $after) {\n    items {\n      id\n      category {\n        id\n        name\n      }\n      status\n      createdAt\n      lastMessageAt\n    }\n    nextCursor\n  }\n}": types.ClientMyInquiriesDocument,
    "mutation ClientSubmitGuestInquiry($input: GuestInquiryInput!) {\n  submitGuestInquiry(input: $input)\n}": types.ClientSubmitGuestInquiryDocument,
    "mutation ClientSubmitMemberInquiry($input: MemberInquiryInput!) {\n  submitMemberInquiry(input: $input) {\n    id\n  }\n}": types.ClientSubmitMemberInquiryDocument,
    "query ClientLegalDocumentVersion($kind: LegalDocumentKind!, $versionNumber: Int!) {\n  legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {\n    publishedAt\n    changeSummary\n    body\n    isLatest\n  }\n}": types.ClientLegalDocumentVersionDocument,
    "query ClientLegalDocument($kind: LegalDocumentKind!) {\n  legalDocument(kind: $kind) {\n    latest {\n      versionNumber\n      publishedAt\n      body\n    }\n    revisions {\n      versionNumber\n      publishedAt\n      changeSummary\n    }\n  }\n}": types.ClientLegalDocumentDocument,
    "query ClientCheckout($purchaseId: ID!) {\n  checkout(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}": types.ClientCheckoutDocument,
    "mutation ClientConfirmCheckoutReturn($sessionId: String!) {\n  confirmCheckoutReturn(sessionId: $sessionId) {\n    checkout {\n      purchaseId\n      kind\n      status\n      rejectionReason\n      unitPrice {\n        amount\n        currency\n      }\n      quantity\n      total {\n        amount\n        currency\n      }\n      summary {\n        itemName\n        quantityLabel\n        serviceTiming\n        additionalNotes\n        isSubscription\n      }\n      acceptUntil\n      expiresAt\n      canRestart\n    }\n  }\n}": types.ClientConfirmCheckoutReturnDocument,
    "query ClientPaymentHistory($first: Int, $after: String) {\n  paymentHistory(first: $first, after: $after) {\n    nodes {\n      id\n      kind\n      purpose\n      amount {\n        amount\n        currency\n      }\n      quantity\n      status\n      occurredAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": types.ClientPaymentHistoryDocument,
    "mutation ClientRecordCheckoutConsent($purchaseId: ID!) {\n  recordCheckoutConsent(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}": types.ClientRecordCheckoutConsentDocument,
    "mutation ClientStartSmokeCheckout {\n  startSmokeCheckout {\n    purchaseId\n  }\n}": types.ClientStartSmokeCheckoutDocument,
    "mutation ClientFollowUser($handle: String!) {\n  followUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}": types.ClientFollowUserDocument,
    "query ClientHandleAvailability($handle: String!) {\n  handleAvailability(handle: $handle)\n}": types.ClientHandleAvailabilityDocument,
    "query ClientMyFollowers($first: Int!, $after: String) {\n  myFollowers(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": types.ClientMyFollowersDocument,
    "query ClientMyFollowing($first: Int!, $after: String) {\n  myFollowing(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}": types.ClientMyFollowingDocument,
    "query ClientMyProfile {\n  myProfile {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}": types.ClientMyProfileDocument,
    "query ClientPublicProfile($handle: String!) {\n  publicProfile(handle: $handle) {\n    __typename\n    ... on PublicProfile {\n      handle\n      nickname\n      headline\n      bio\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      websites {\n        name\n        url\n      }\n      followerCount\n      ultras\n      suspended\n      viewerRelation\n    }\n    ... on PublicProfileRedirect {\n      handle\n    }\n  }\n}": types.ClientPublicProfileDocument,
    "mutation ClientUnfollowUser($handle: String!) {\n  unfollowUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}": types.ClientUnfollowUserDocument,
    "mutation ClientUpdateMyProfile($input: UpdateMyProfileInput!) {\n  updateMyProfile(input: $input) {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}": types.ClientUpdateMyProfileDocument,
    "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}": types.ClientSystemStatusDocument,
    "mutation ClientCreateUltrasPortalSession {\n  createUltrasPortalSession {\n    url\n  }\n}": types.ClientCreateUltrasPortalSessionDocument,
    "mutation ClientStartUltrasCheckout {\n  startUltrasCheckout {\n    purchaseId\n  }\n}": types.ClientStartUltrasCheckoutDocument,
    "query ClientUltrasOffer {\n  ultrasOffer {\n    price {\n      amount\n      currency\n    }\n    priceStale\n    promotionEnabled\n  }\n}": types.ClientUltrasOfferDocument,
    "query ClientViewerUltras {\n  viewerUltras {\n    entitled\n    canOpenPortal\n    plan {\n      status\n      startedAt\n      currentPeriodEndsAt\n      canceledAt\n      benefitEndsAt\n    }\n  }\n}": types.ClientViewerUltrasDocument,
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
export function graphql(source: "query ClientMemberInquiry($id: ID!) {\n  memberInquiry(id: $id) {\n    id\n    category {\n      id\n      name\n    }\n    status\n    createdAt\n    messages {\n      id\n      sender\n      body\n      attachments {\n        id\n        originalFileName\n        contentType\n        byteSize\n      }\n      admin {\n        nickname\n        avatar {\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n        deleted\n      }\n      createdAt\n    }\n    canPost\n  }\n}"): (typeof documents)["query ClientMemberInquiry($id: ID!) {\n  memberInquiry(id: $id) {\n    id\n    category {\n      id\n      name\n    }\n    status\n    createdAt\n    messages {\n      id\n      sender\n      body\n      attachments {\n        id\n        originalFileName\n        contentType\n        byteSize\n      }\n      admin {\n        nickname\n        avatar {\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n        deleted\n      }\n      createdAt\n    }\n    canPost\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientPostInquiryMessage($inquiryId: ID!, $input: InquiryMessageInput!) {\n  postInquiryMessage(inquiryId: $inquiryId, input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ClientPostInquiryMessage($inquiryId: ID!, $input: InquiryMessageInput!) {\n  postInquiryMessage(inquiryId: $inquiryId, input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientInquiryContactForm {\n  inquiryCategories {\n    id\n    name\n  }\n  inquiryComposer {\n    nickname\n    avatar {\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n  }\n}"): (typeof documents)["query ClientInquiryContactForm {\n  inquiryCategories {\n    id\n    name\n  }\n  inquiryComposer {\n    nickname\n    avatar {\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientMyInquiries($after: String) {\n  myInquiries(after: $after) {\n    items {\n      id\n      category {\n        id\n        name\n      }\n      status\n      createdAt\n      lastMessageAt\n    }\n    nextCursor\n  }\n}"): (typeof documents)["query ClientMyInquiries($after: String) {\n  myInquiries(after: $after) {\n    items {\n      id\n      category {\n        id\n        name\n      }\n      status\n      createdAt\n      lastMessageAt\n    }\n    nextCursor\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientSubmitGuestInquiry($input: GuestInquiryInput!) {\n  submitGuestInquiry(input: $input)\n}"): (typeof documents)["mutation ClientSubmitGuestInquiry($input: GuestInquiryInput!) {\n  submitGuestInquiry(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientSubmitMemberInquiry($input: MemberInquiryInput!) {\n  submitMemberInquiry(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ClientSubmitMemberInquiry($input: MemberInquiryInput!) {\n  submitMemberInquiry(input: $input) {\n    id\n  }\n}"];
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
export function graphql(source: "query ClientCheckout($purchaseId: ID!) {\n  checkout(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}"): (typeof documents)["query ClientCheckout($purchaseId: ID!) {\n  checkout(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientConfirmCheckoutReturn($sessionId: String!) {\n  confirmCheckoutReturn(sessionId: $sessionId) {\n    checkout {\n      purchaseId\n      kind\n      status\n      rejectionReason\n      unitPrice {\n        amount\n        currency\n      }\n      quantity\n      total {\n        amount\n        currency\n      }\n      summary {\n        itemName\n        quantityLabel\n        serviceTiming\n        additionalNotes\n        isSubscription\n      }\n      acceptUntil\n      expiresAt\n      canRestart\n    }\n  }\n}"): (typeof documents)["mutation ClientConfirmCheckoutReturn($sessionId: String!) {\n  confirmCheckoutReturn(sessionId: $sessionId) {\n    checkout {\n      purchaseId\n      kind\n      status\n      rejectionReason\n      unitPrice {\n        amount\n        currency\n      }\n      quantity\n      total {\n        amount\n        currency\n      }\n      summary {\n        itemName\n        quantityLabel\n        serviceTiming\n        additionalNotes\n        isSubscription\n      }\n      acceptUntil\n      expiresAt\n      canRestart\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientPaymentHistory($first: Int, $after: String) {\n  paymentHistory(first: $first, after: $after) {\n    nodes {\n      id\n      kind\n      purpose\n      amount {\n        amount\n        currency\n      }\n      quantity\n      status\n      occurredAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"): (typeof documents)["query ClientPaymentHistory($first: Int, $after: String) {\n  paymentHistory(first: $first, after: $after) {\n    nodes {\n      id\n      kind\n      purpose\n      amount {\n        amount\n        currency\n      }\n      quantity\n      status\n      occurredAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientRecordCheckoutConsent($purchaseId: ID!) {\n  recordCheckoutConsent(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}"): (typeof documents)["mutation ClientRecordCheckoutConsent($purchaseId: ID!) {\n  recordCheckoutConsent(purchaseId: $purchaseId) {\n    purchaseId\n    kind\n    status\n    rejectionReason\n    clientSecret\n    unitPrice {\n      amount\n      currency\n    }\n    quantity\n    total {\n      amount\n      currency\n    }\n    summary {\n      itemName\n      quantityLabel\n      serviceTiming\n      additionalNotes\n      isSubscription\n    }\n    acceptUntil\n    expiresAt\n    consentVersion\n    canRestart\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientStartSmokeCheckout {\n  startSmokeCheckout {\n    purchaseId\n  }\n}"): (typeof documents)["mutation ClientStartSmokeCheckout {\n  startSmokeCheckout {\n    purchaseId\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientFollowUser($handle: String!) {\n  followUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}"): (typeof documents)["mutation ClientFollowUser($handle: String!) {\n  followUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientHandleAvailability($handle: String!) {\n  handleAvailability(handle: $handle)\n}"): (typeof documents)["query ClientHandleAvailability($handle: String!) {\n  handleAvailability(handle: $handle)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientMyFollowers($first: Int!, $after: String) {\n  myFollowers(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"): (typeof documents)["query ClientMyFollowers($first: Int!, $after: String) {\n  myFollowers(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientMyFollowing($first: Int!, $after: String) {\n  myFollowing(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"): (typeof documents)["query ClientMyFollowing($first: Int!, $after: String) {\n  myFollowing(first: $first, after: $after) {\n    nodes {\n      user {\n        handle\n        nickname\n        avatar {\n          id\n          objectKey\n          fallbackFormat\n          width\n          height\n        }\n      }\n      followedAt\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientMyProfile {\n  myProfile {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}"): (typeof documents)["query ClientMyProfile {\n  myProfile {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientPublicProfile($handle: String!) {\n  publicProfile(handle: $handle) {\n    __typename\n    ... on PublicProfile {\n      handle\n      nickname\n      headline\n      bio\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      websites {\n        name\n        url\n      }\n      followerCount\n      ultras\n      suspended\n      viewerRelation\n    }\n    ... on PublicProfileRedirect {\n      handle\n    }\n  }\n}"): (typeof documents)["query ClientPublicProfile($handle: String!) {\n  publicProfile(handle: $handle) {\n    __typename\n    ... on PublicProfile {\n      handle\n      nickname\n      headline\n      bio\n      avatar {\n        id\n        objectKey\n        fallbackFormat\n        width\n        height\n      }\n      websites {\n        name\n        url\n      }\n      followerCount\n      ultras\n      suspended\n      viewerRelation\n    }\n    ... on PublicProfileRedirect {\n      handle\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientUnfollowUser($handle: String!) {\n  unfollowUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}"): (typeof documents)["mutation ClientUnfollowUser($handle: String!) {\n  unfollowUser(handle: $handle) {\n    handle\n    following\n    followerCount\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientUpdateMyProfile($input: UpdateMyProfileInput!) {\n  updateMyProfile(input: $input) {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}"): (typeof documents)["mutation ClientUpdateMyProfile($input: UpdateMyProfileInput!) {\n  updateMyProfile(input: $input) {\n    nickname\n    handle\n    previousHandle\n    headline\n    bio\n    avatar {\n      id\n      objectKey\n      fallbackFormat\n      width\n      height\n    }\n    websites {\n      name\n      url\n    }\n    suspended\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"): (typeof documents)["query ClientSystemStatus {\n  systemStatus {\n    serverTime\n    databaseReachable\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientCreateUltrasPortalSession {\n  createUltrasPortalSession {\n    url\n  }\n}"): (typeof documents)["mutation ClientCreateUltrasPortalSession {\n  createUltrasPortalSession {\n    url\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ClientStartUltrasCheckout {\n  startUltrasCheckout {\n    purchaseId\n  }\n}"): (typeof documents)["mutation ClientStartUltrasCheckout {\n  startUltrasCheckout {\n    purchaseId\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientUltrasOffer {\n  ultrasOffer {\n    price {\n      amount\n      currency\n    }\n    priceStale\n    promotionEnabled\n  }\n}"): (typeof documents)["query ClientUltrasOffer {\n  ultrasOffer {\n    price {\n      amount\n      currency\n    }\n    priceStale\n    promotionEnabled\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ClientViewerUltras {\n  viewerUltras {\n    entitled\n    canOpenPortal\n    plan {\n      status\n      startedAt\n      currentPeriodEndsAt\n      canceledAt\n      benefitEndsAt\n    }\n  }\n}"): (typeof documents)["query ClientViewerUltras {\n  viewerUltras {\n    entitled\n    canOpenPortal\n    plan {\n      status\n      startedAt\n      currentPeriodEndsAt\n      canceledAt\n      benefitEndsAt\n    }\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;