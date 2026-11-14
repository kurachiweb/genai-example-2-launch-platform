import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../common-lib/admin/audit-actions/notifications.ts';
import { adminAuditLogs } from '../../db/schema/admin/admin-audit-logs.ts';
import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { notificationPreferences } from '../../db/schema/notifications/notification-preferences.ts';
import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { SuppressionRecorder } from '../../lib/core/email/ports.ts';
import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import { unsubscribeTokenKey } from '../../lib/core/notifications/notice-email.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../lib/core/notifications/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  recipientIdOf,
  restoreSenderInfoSeed,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  type NotificationSettingsService,
  StoreNotificationSettingsService,
} from '../application/notifications/notification-settings-service.ts';
import { NOTIFICATIONS_TYPES } from '../application/notifications/notifications-types.ts';
import type { DeliveryStatusReader } from '../application/notifications/ports.ts';
import {
  type SenderInfoService,
  StoreSenderInfoService,
} from '../application/notifications/sender-info-service.ts';
import {
  TokenUnsubscribeService,
  type UnsubscribeService,
} from '../application/notifications/unsubscribe-service.ts';
import {
  adminIdOf,
  clearAdminTables,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import { AccountWithdrawalSyncHandler } from '../infrastructure/notifications/account-withdrawal-sync-handler.ts';
import { D1SenderInfoWriter } from '../infrastructure/notifications/d1-sender-info-writer.ts';
import { SuppressionDeliveryStatusReader } from '../infrastructure/notifications/delivery-status-reader.ts';
import { MODULES } from './modules.ts';

const NOW = new Date('2026-11-20T03:00:00.000Z');

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

const currentUserOf = (index: number): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: recipientIdOf(index),
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: recipientIdOf(index),
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: T0,
    deletedAt: null,
    email: 'owner@mail.example',
    nickname: 'オーナー',
    handle: 'owner',
  },
});

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await clearNotificationTables();
  await clearAdminTables();
  await restoreSenderInfoSeed();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーの通知の束縛', () => {
  test('モジュールの一覧に通知のモジュールを1つだけ持ち、通知の共通の束縛の後に置く', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'notifications')).toHaveLength(1);
    expect(names.indexOf('notifications')).toBeGreaterThan(
      names.indexOf('notifications-platform'),
    );
  });

  test.each([
    [
      'DeliveryStatusReader',
      NOTIFICATIONS_TYPES.DeliveryStatusReader,
      SuppressionDeliveryStatusReader,
    ],
    [
      'NotificationSettingsService',
      NOTIFICATIONS_TYPES.NotificationSettingsService,
      StoreNotificationSettingsService,
    ],
    [
      'UnsubscribeService',
      NOTIFICATIONS_TYPES.UnsubscribeService,
      TokenUnsubscribeService,
    ],
    [
      'SenderInfoService',
      NOTIFICATIONS_TYPES.SenderInfoService,
      StoreSenderInfoService,
    ],
    [
      'SenderInfoWriter',
      NOTIFICATIONS_TYPES.SenderInfoWriter,
      D1SenderInfoWriter,
    ],
    [
      'AccountWithdrawalSyncHandler',
      NOTIFICATIONS_TYPES.AccountWithdrawalSyncHandler,
      AccountWithdrawalSyncHandler,
    ],
  ] as const)(
    '処理単位のコンテナから%sを解決する',
    (_name, identifier, implementation) => {
      expect(createContainer().get(identifier)).toBeInstanceOf(implementation);
    },
  );

  test('定期実行の処理単位のコンテナも通知の束縛を含めて組み立てられる', () => {
    expect(
      createContainer('scheduled').get<DeliveryStatusReader>(
        NOTIFICATIONS_TYPES.DeliveryStatusReader,
      ),
    ).toBeInstanceOf(SuppressionDeliveryStatusReader);
  });

  test('束縛から取り出したユースケースが1種別だけを保存し、連絡先の除外を含む最新の設定を返す', async () => {
    await insertRecipient(1, {
      email: 'owner@mail.example',
      emailVerifiedAt: T0,
    });
    const container = createContainer();
    await container
      .get<SuppressionRecorder>(EMAIL_TYPES.SuppressionRecorder)
      .record('owner@mail.example', {
        lastReason: 'complaint',
        lastEventAt: T0,
        expiresAt: null,
      });
    const service = container.get<NotificationSettingsService>(
      NOTIFICATIONS_TYPES.NotificationSettingsService,
    );

    const view = await service.update(
      currentUserOf(1),
      'followed_user_match',
      true,
      NOW,
    );

    expect(view).toEqual({
      preferences: new Map([
        ['match_preview', false],
        ['match_result', false],
        ['followed_user_match', true],
        ['followed_user_award', false],
      ]),
      delivery: { kind: 'suppressed', reason: 'complaint', until: null },
      emailVerified: true,
      editable: true,
    });
    await expect(
      db
        .select({
          topic: notificationPreferences.topic,
          enabled: notificationPreferences.enabled,
          updatedAt: notificationPreferences.updatedAt,
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, recipientIdOf(1))),
    ).resolves.toEqual([
      { topic: 'followed_user_match', enabled: true, updatedAt: NOW },
    ]);
  });

  test('束縛から取り出した配信停止のユースケースが、発行したトークンの組の種別だけを停止する', async () => {
    await insertRecipient(1, { emailVerifiedAt: T0 });
    const container = createContainer();
    const preferences = container.get<NotificationPreferenceStore>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
    );
    for (const topic of ['match_result', 'match_preview'] as const) {
      await preferences.setPreference({
        userId: recipientIdOf(1),
        topic,
        enabled: true,
        at: T0,
      });
    }
    const target = { userId: recipientIdOf(1), topic: 'match_result' } as const;
    const tokens = await container
      .get<UnsubscribeTokenService>(
        NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
      )
      .tokensFor([target], T0);
    const token = tokens.get(unsubscribeTokenKey(target)) ?? '';
    const service = container.get<UnsubscribeService>(
      NOTIFICATIONS_TYPES.UnsubscribeService,
    );

    await expect(service.inspect(token)).resolves.toEqual({
      topic: 'match_result',
      enabled: true,
    });
    await expect(service.confirm(token, NOW)).resolves.toEqual({
      topic: 'match_result',
      alreadyDisabled: false,
    });
    await expect(service.confirm(token, NOW)).resolves.toEqual({
      topic: 'match_result',
      alreadyDisabled: true,
    });
    await expect(preferences.preferencesOf(recipientIdOf(1))).resolves.toEqual(
      new Map([
        ['match_preview', true],
        ['match_result', false],
        ['followed_user_match', false],
        ['followed_user_award', false],
      ]),
    );
    await expect(service.inspect(`${token}x`)).resolves.toBeNull();
  });

  test('束縛から取り出した送信者情報のユースケースが、シードの行へ保存して監査ログを残し、同じ版からの2回目の保存を版の競合で拒否する', async () => {
    const service = createContainer().get<SenderInfoService>(
      NOTIFICATIONS_TYPES.SenderInfoService,
    );
    const info = {
      businessName: 'ローンチ運営事務局',
      contactEmail: 'support@launch.example',
      postalAddress: '東京都千代田区1-1-1',
    };

    await expect(
      service.update({
        adminId: adminIdOf(1),
        info,
        expectedVersion: 0,
        reason: undefined,
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: 'saved',
      view: {
        info,
        version: 1,
        updatedAt: NOW,
        updatedByAdminId: adminIdOf(1),
      },
    });
    await expect(
      service.update({
        adminId: adminIdOf(2),
        info,
        expectedVersion: 0,
        reason: undefined,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      db
        .select({
          operatorAdminId: adminAuditLogs.operatorAdminId,
          action: adminAuditLogs.action,
          detail: adminAuditLogs.detail,
        })
        .from(adminAuditLogs),
    ).resolves.toEqual([
      {
        operatorAdminId: adminIdOf(1),
        action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
        detail: { fields: 'businessName,contactEmail,postalAddress' },
      },
    ]);
  });
});
