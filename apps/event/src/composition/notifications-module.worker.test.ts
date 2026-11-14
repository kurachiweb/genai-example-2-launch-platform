import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { notificationSenderSettings } from '../../db/schema/notifications/notification-sender-settings.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { SenderInfoProvider } from '../../lib/core/email/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  db,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import { D1SenderInfoProvider } from '../infrastructure/notifications/d1-sender-info-provider.ts';
import { EveningCollector } from '../infrastructure/notifications/evening-collector.ts';
import { MorningCollector } from '../infrastructure/notifications/morning-collector.ts';
import { EMAIL_SENDER_INFO_PROVIDER } from './email-registrations.ts';
import { MODULES } from './modules.ts';

const SENDER_INFO = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
} as const;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

const IMPLEMENTATIONS = [
  ['EveningCollector', EveningCollector],
  ['MorningCollector', MorningCollector],
] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await restoreSenderInfoSeed();
});

describe('イベントサーバーのモジュールの一覧への通知のモジュールの登録', () => {
  test('通知のモジュールを1つだけ持ち、通知の共通の束縛の後に置く', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'event-notifications')).toHaveLength(
      1,
    );
    expect(names.indexOf('event-notifications')).toBeGreaterThan(
      names.indexOf('notifications-platform'),
    );
  });

  test('メールの送信者情報の取得口の登録箇所は、通知の送信者情報の実装を指す', () => {
    expect(EMAIL_SENDER_INFO_PROVIDER).toBe(D1SenderInfoProvider);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのメールの送信者情報の取得口(%s)',
  (kind) => {
    test('処理単位のコンテナから通知の送信者情報の実装に解決する', () => {
      expect(
        createContainer(kind).get(EMAIL_TYPES.SenderInfoProvider),
      ).toBeInstanceOf(D1SenderInfoProvider);
    });

    test('送信者情報が版0ならundefinedを、設定済みなら3項目を返す', async () => {
      const provider = createContainer(kind).get<SenderInfoProvider>(
        EMAIL_TYPES.SenderInfoProvider,
      );
      await expect(provider.get()).resolves.toBeUndefined();

      await db
        .update(notificationSenderSettings)
        .set({ ...SENDER_INFO, version: 1, updatedAt: after(1) })
        .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));

      await expect(provider.get()).resolves.toStrictEqual(SENDER_INFO);
    });
  },
);

describe('イベントサーバーの通知の識別子の解決', () => {
  test('解決を確かめる識別子はEVENT_NOTIFICATIONS_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(EVENT_NOTIFICATIONS_TYPES).toSorted(),
    );
  });

  describe.each(INVOCATION_KINDS)('%sの処理単位のコンテナ', (kind) => {
    test.each(IMPLEMENTATIONS)('%sを解決する', (name, implementation) => {
      expect(
        createContainer(kind).get(EVENT_NOTIFICATIONS_TYPES[name]),
      ).toBeInstanceOf(implementation);
    });
  });
});
