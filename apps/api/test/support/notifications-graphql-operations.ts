import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { NotificationTopic } from '../../common-lib/notifications/notification-topics.ts';
import type { Database } from '../../db/client.ts';
import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { notificationSenderSettings } from '../../db/schema/notifications/notification-sender-settings.ts';
import { users } from '../../db/schema/identity/users.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  SenderInfo,
  SuppressionList,
} from '../../lib/core/email/ports.ts';
import type { SuppressionReason } from '../../lib/core/email/suppression-policy.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { UnsubscribeTokenService } from '../../lib/core/notifications/ports.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createSuppressionRepository } from '../../lib/workers/email/suppression-repository.ts';
import { SENDER_INFO_SETTING_KEY } from '../../lib/workers/notifications/d1-sender-info-store.ts';
import {
  clearNotificationTables,
  db,
  restoreSenderInfoSeed,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { notificationsSchemaModule } from '../../src/presentation/graphql/modules/notifications/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
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

export type NotificationTopicValue =
  | 'MATCH_PREVIEW'
  | 'MATCH_RESULT'
  | 'FOLLOWED_USER_MATCH'
  | 'FOLLOWED_USER_AWARD';

export interface NotificationSettingsFields {
  readonly preferences: readonly {
    readonly topic: NotificationTopicValue;
    readonly enabled: boolean;
  }[];
  readonly suppression: {
    readonly reason: 'BOUNCE' | 'COMPLAINT' | 'REJECTED';
    readonly until: string | null;
  } | null;
  readonly deliveryStatusAvailable: boolean;
  readonly emailVerified: boolean;
  readonly editable: boolean;
}

export interface NotificationUnsubscribeLinkFields {
  readonly topic: NotificationTopicValue;
  readonly enabled: boolean;
}

export interface NotificationSenderInfoStateFields {
  readonly info: SenderInfo | null;
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedByNickname: string | null;
}

const NOTIFICATION_SETTINGS_FIELDS = /* GraphQL */ `
  preferences {
    topic
    enabled
  }
  suppression {
    reason
    until
  }
  deliveryStatusAvailable
  emailVerified
  editable
`;

export const VIEWER_NOTIFICATION_SETTINGS = /* GraphQL */ `
  query ClientViewerNotificationSettings {
    viewerNotificationSettings {
      ${NOTIFICATION_SETTINGS_FIELDS}
    }
  }
`;

export const UPDATE_NOTIFICATION_PREFERENCE = /* GraphQL */ `
  mutation ClientUpdateNotificationPreference(
    $input: UpdateNotificationPreferenceInput!
  ) {
    updateNotificationPreference(input: $input) {
      ${NOTIFICATION_SETTINGS_FIELDS}
    }
  }
`;

export const NOTIFICATION_UNSUBSCRIBE_LINK = /* GraphQL */ `
  query ClientNotificationUnsubscribeLink($token: String!) {
    notificationUnsubscribeLink(token: $token) {
      topic
      enabled
    }
  }
`;

export const CONFIRM_NOTIFICATION_UNSUBSCRIBE = /* GraphQL */ `
  mutation ClientConfirmNotificationUnsubscribe($token: String!) {
    confirmNotificationUnsubscribe(token: $token) {
      topic
      enabled
    }
  }
`;

const NOTIFICATION_SENDER_INFO_STATE_FIELDS = /* GraphQL */ `
  info {
    businessName
    contactEmail
    postalAddress
  }
  version
  updatedAt
  updatedByNickname
`;

export const NOTIFICATION_SENDER_INFO = /* GraphQL */ `
  query AdminNotificationSenderInfo {
    notificationSenderInfo {
      ${NOTIFICATION_SENDER_INFO_STATE_FIELDS}
    }
  }
`;

export const UPDATE_NOTIFICATION_SENDER_INFO = /* GraphQL */ `
  mutation AdminUpdateNotificationSenderInfo(
    $input: UpdateNotificationSenderInfoInput!
  ) {
    updateNotificationSenderInfo(input: $input) {
      ${NOTIFICATION_SENDER_INFO_STATE_FIELDS}
    }
  }
`;

let suppressionLookupFails = false;

const failingSuppressionList: SuppressionList = {
  getStatus: () => Promise.reject(new Error('抑止の照会に失敗しました')),
  findSuppressed: () => Promise.reject(new Error('抑止の照会に失敗しました')),
};

// テストが指定したときだけ、抑止の照会を失敗させる
const overridesModule: AppModule<GatewayApp> = {
  name: 'notifications-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<SuppressionList>(EMAIL_TYPES.SuppressionList).toDynamicValue(
      (context) =>
        suppressionLookupFails
          ? failingSuppressionList
          : createSuppressionRepository(
              context.get<Database>(PLATFORM_TYPES.Database),
              context.get<Clock>(PLATFORM_TYPES.Clock),
            ),
    );
  }),
};

const notificationsGateway = createGraphQLGateway({
  documents: [
    VIEWER_NOTIFICATION_SETTINGS,
    UPDATE_NOTIFICATION_PREFERENCE,
    NOTIFICATION_UNSUBSCRIBE_LINK,
    CONFIRM_NOTIFICATION_UNSUBSCRIBE,
    NOTIFICATION_SENDER_INFO,
    UPDATE_NOTIFICATION_SENDER_INFO,
  ],
  schemaModules: [notificationsSchemaModule],
  overrides: [overridesModule],
});

export interface NotificationsTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前に通知・利用者・抑止のテーブルとログの記録を空にし、抑止の照会を戻す
export function installNotificationsGraphQLTest(): NotificationsTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await db.delete(emailSuppressions);
    await clearNotificationTables();
    suppressionLookupFails = false;
    logs.splice(0);
  });

  afterAll(() => {
    resetSync();
  });

  return { logs: () => logs };
}

export function failSuppressionLookup(): void {
  suppressionLookupFails = true;
}

function createContainer() {
  return createInvocationContainer(
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
}

// 本物の発行の部品で、保存済みの利用者のセッションを作る
export async function issueSessionOf(userId: string): Promise<string> {
  const issued = await createContainer()
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userId, {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

// 本物のトークンのサービスで、通知メールに載せる配信停止のトークンを作る
export async function unsubscribeTokenOf(
  userId: string,
  topic: NotificationTopic,
): Promise<string> {
  const tokens = await createContainer()
    .get<UnsubscribeTokenService>(
      NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
    )
    .tokensFor([{ userId, topic }], T0);
  const token = tokens.get(`${userId}:${topic}`);
  if (token === undefined) {
    throw new Error('配信停止のトークンを作れませんでした');
  }
  return token;
}

export async function suspendUserById(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended', suspendedAt: T0 })
    .where(eq(users.id, userId));
}

export async function suppressAddress(
  address: string,
  reason: SuppressionReason,
  expiresAt: Date | null,
): Promise<void> {
  await createSuppressionRepository(db, {
    now: () => new Date(),
  }).record(address, { lastReason: reason, lastEventAt: T0, expiresAt });
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function fetchViewerNotificationSettings(options?: GatewayCallOptions) {
  return notificationsGateway.call<{
    viewerNotificationSettings: NotificationSettingsFields | null;
  }>(VIEWER_NOTIFICATION_SETTINGS, {}, options);
}

export function updateNotificationPreference(
  input: { readonly topic: NotificationTopicValue; readonly enabled: boolean },
  options?: GatewayCallOptions,
) {
  return notificationsGateway.call<{
    updateNotificationPreference: NotificationSettingsFields | null;
  }>(UPDATE_NOTIFICATION_PREFERENCE, { input }, options);
}

export function fetchNotificationUnsubscribeLink(
  token: string,
  options?: GatewayCallOptions,
) {
  return notificationsGateway.call<{
    notificationUnsubscribeLink: NotificationUnsubscribeLinkFields | null;
  }>(NOTIFICATION_UNSUBSCRIBE_LINK, { token }, options);
}

export function confirmNotificationUnsubscribe(
  token: string,
  options?: GatewayCallOptions,
) {
  return notificationsGateway.call<{
    confirmNotificationUnsubscribe: NotificationUnsubscribeLinkFields | null;
  }>(CONFIRM_NOTIFICATION_UNSUBSCRIBE, { token }, options);
}

export function fetchNotificationSenderInfo(options?: GatewayCallOptions) {
  return notificationsGateway.call<{
    notificationSenderInfo: NotificationSenderInfoStateFields | null;
  }>(NOTIFICATION_SENDER_INFO, {}, options);
}

export function updateNotificationSenderInfo(
  input: Record<string, unknown>,
  options?: GatewayCallOptions,
) {
  return notificationsGateway.call<{
    updateNotificationSenderInfo: NotificationSenderInfoStateFields | null;
  }>(UPDATE_NOTIFICATION_SENDER_INFO, { input }, options);
}

// 削除済みの管理者は行を作らずにIDだけを使い、招待中の管理者は行だけを作ってセッションを持たない
export const SENDER_INFO_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
  secondSuperAdmin: 4,
  invited: 8,
  deleted: 9,
});

const ROLES_OF_SIGNED_IN_ADMINS: readonly (readonly [number, AdminRole])[] = [
  [SENDER_INFO_ADMINS.superAdmin, 'super_admin'],
  [SENDER_INFO_ADMINS.moderator, 'moderator'],
  [SENDER_INFO_ADMINS.viewer, 'viewer'],
  [SENDER_INFO_ADMINS.secondSuperAdmin, 'super_admin'],
];

const adminSessionTokens = new Map<number, string>();

export function asSenderInfoAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

// 管理者側の操作を確かめる区画の中で呼び、各テストの前に送信者情報の初期行と監査ログを含む管理者の表を戻して、ログインした管理者とそのセッションを用意する
export function installSenderInfoAdminFixtures(): void {
  beforeEach(async () => {
    await restoreSenderInfoSeed();
    await clearAdminTables();
    adminSessionTokens.clear();
    for (const [index, role] of ROLES_OF_SIGNED_IN_ADMINS) {
      await insertAdmin(index, { role });
      adminSessionTokens.set(
        index,
        (await issueAdminSession(adminIdOf(index))).token,
      );
    }
  });
}

// 管理画面を通さずに、指定した管理者が最後に保存した送信者情報を再現する
export async function markSenderInfoUpdatedBy(
  adminId: string,
  info: SenderInfo,
  at: Date,
): Promise<void> {
  await db
    .update(notificationSenderSettings)
    .set({ ...info, version: 1, updatedByAdminId: adminId, updatedAt: at })
    .where(eq(notificationSenderSettings.settingKey, SENDER_INFO_SETTING_KEY));
}

export async function readSenderInfoRow() {
  const [row] = await db
    .select()
    .from(notificationSenderSettings)
    .where(eq(notificationSenderSettings.settingKey, SENDER_INFO_SETTING_KEY));
  return row;
}
