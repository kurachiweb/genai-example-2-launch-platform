import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type { NotificationPreferenceStore } from '../../../lib/core/notifications/ports.ts';
import {
  type NotificationSettingsService,
  StoreNotificationSettingsService,
} from './notification-settings-service.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import type { DeliveryStatus, DeliveryStatusReader } from './ports.ts';

const USER_ID = '01JC0RCPT00000000000000001';

const OTHER_USER_ID = '01JC0RCPT00000000000000002';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const UNTIL = new Date('2026-11-27T03:00:00.000Z');

interface SavedPreference {
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly enabled: boolean;
  readonly at: Date;
}

interface FakePreferenceStore extends NotificationPreferenceStore {
  readonly saved: SavedPreference[];
}

const currentUserOf = (
  overrides: Partial<UserAccountView> = {},
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-11-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'alice@mail.example',
    nickname: 'アリス',
    handle: 'alice',
    ...overrides,
  },
});

function createPreferenceStore(
  initial: Partial<Record<NotificationTopic, boolean>> = {},
): FakePreferenceStore {
  const values = new Map<string, Map<NotificationTopic, boolean>>([
    [
      USER_ID,
      new Map(Object.entries(initial) as [NotificationTopic, boolean][]),
    ],
    [OTHER_USER_ID, new Map(NOTIFICATION_TOPICS.map((topic) => [topic, true]))],
  ]);
  const saved: SavedPreference[] = [];
  const unused = (): never => {
    throw new Error('テストでは使わない');
  };
  return {
    saved,
    preferencesOf: (userId) => {
      const stored =
        values.get(userId) ?? new Map<NotificationTopic, boolean>();
      return Promise.resolve(
        new Map(
          NOTIFICATION_TOPICS.map(
            (topic) => [topic, stored.get(topic) ?? false] as const,
          ),
        ),
      );
    },
    setPreference: (input) => {
      saved.push(input);
      const stored =
        values.get(input.userId) ?? new Map<NotificationTopic, boolean>();
      stored.set(input.topic, input.enabled);
      values.set(input.userId, stored);
      return Promise.resolve();
    },
    eligibleRecipients: unused,
    enabledTopicsOf: unused,
    deleteAllOf: unused,
  };
}

function createDeliveryStatusReader(
  status: DeliveryStatus | Error,
): DeliveryStatusReader & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    statusOf: (userId) => {
      asked.push(userId);
      return status instanceof Error
        ? Promise.reject(status)
        : Promise.resolve(status);
    },
  };
}

function setup(
  options: {
    readonly preferences?: Partial<Record<NotificationTopic, boolean>>;
    readonly delivery?: DeliveryStatus | Error;
  } = {},
) {
  const store = createPreferenceStore(options.preferences);
  const reader = createDeliveryStatusReader(
    options.delivery ?? { kind: 'deliverable' },
  );
  return {
    store,
    reader,
    service: new StoreNotificationSettingsService(store, reader),
  };
}

const allTopics = (
  enabled: Partial<Record<NotificationTopic, boolean>>,
): ReadonlyMap<NotificationTopic, boolean> =>
  new Map(NOTIFICATION_TOPICS.map((topic) => [topic, enabled[topic] ?? false]));

describe('StoreNotificationSettingsService.read', () => {
  test('引数の利用者の4種別の受信可否を返し、他の利用者の設定を混ぜない', async () => {
    const { service, reader } = setup({
      preferences: { match_preview: true, followed_user_award: true },
    });

    const view = await service.read(currentUserOf());

    expect(view.preferences).toEqual(
      allTopics({ match_preview: true, followed_user_award: true }),
    );
    expect(reader.asked).toEqual([USER_ID]);
  });

  test('設定の無い利用者は4種別とも受信しない設定として返す', async () => {
    const { service } = setup();

    const view = await service.read(currentUserOf());

    expect(view.preferences).toEqual(allTopics({}));
  });

  test('確認済みで有効な利用者は配信できる状態で変更できる', async () => {
    const { service } = setup();

    expect(await service.read(currentUserOf())).toEqual({
      preferences: allTopics({}),
      delivery: { kind: 'deliverable' },
      emailVerified: true,
      editable: true,
    });
  });

  test('メールアドレスが未確認の利用者は未確認として返し、変更は受け付ける', async () => {
    const { service } = setup();

    const view = await service.read(currentUserOf({ emailVerifiedAt: null }));

    expect(view.emailVerified).toBe(false);
    expect(view.editable).toBe(true);
  });

  test('停止中の利用者は変更できないとして返す', async () => {
    const { service } = setup({ preferences: { match_result: true } });

    const view = await service.read(currentUserOf({ status: 'suspended' }));

    expect(view.editable).toBe(false);
    expect(view.preferences.get('match_result')).toBe(true);
  });

  test('退会済みの利用者は変更できないとして返す', async () => {
    const { service } = setup();

    const view = await service.read(currentUserOf({ deletedAt: NOW }));

    expect(view.editable).toBe(false);
  });

  test('受信側の拒否による除外は理由と除外が解ける日時を返し、変更は受け付ける', async () => {
    const { service } = setup({
      delivery: { kind: 'suppressed', reason: 'rejected', until: UNTIL },
    });

    const view = await service.read(currentUserOf());

    expect(view.delivery).toEqual({
      kind: 'suppressed',
      reason: 'rejected',
      until: UNTIL,
    });
    expect(view.editable).toBe(true);
  });

  test('期限の無い受信側の拒否による除外は日時を持たない', async () => {
    const { service } = setup({
      delivery: { kind: 'suppressed', reason: 'rejected', until: null },
    });

    expect(await service.read(currentUserOf())).toMatchObject({
      delivery: { kind: 'suppressed', reason: 'rejected', until: null },
    });
  });

  test.each(['bounce', 'complaint'] as const)(
    '%sによる除外は期限が渡されても除外が解ける日時を持たない',
    async (reason) => {
      const { service } = setup({
        delivery: { kind: 'suppressed', reason, until: UNTIL },
      });

      const view = await service.read(currentUserOf());

      expect(view.delivery).toEqual({
        kind: 'suppressed',
        reason,
        until: null,
      });
      expect(view.editable).toBe(true);
    },
  );

  test('配信の状態を確認できなかった照会の結果はunknownのまま返す', async () => {
    const { service } = setup({ delivery: { kind: 'unknown' } });

    expect(await service.read(currentUserOf())).toMatchObject({
      delivery: { kind: 'unknown' },
      editable: true,
    });
  });

  test('配信の状態の照会が失敗しても受信可否を返し、配信の状態をunknownにする', async () => {
    const { service } = setup({
      preferences: { followed_user_match: true },
      delivery: new Error('照会の失敗'),
    });

    const view = await service.read(currentUserOf());

    expect(view.delivery).toEqual({ kind: 'unknown' });
    expect(view.preferences.get('followed_user_match')).toBe(true);
  });
});

describe('StoreNotificationSettingsService.update', () => {
  test('指定した1種別だけを引数の時刻で保存し、最新の設定を返す', async () => {
    const { service, store } = setup({
      preferences: { match_preview: true, match_result: true },
    });

    const view = await service.update(
      currentUserOf(),
      'match_result',
      false,
      NOW,
    );

    expect(store.saved).toEqual([
      { userId: USER_ID, topic: 'match_result', enabled: false, at: NOW },
    ]);
    expect(view).toEqual({
      preferences: allTopics({ match_preview: true }),
      delivery: { kind: 'deliverable' },
      emailVerified: true,
      editable: true,
    });
  });

  test('メールアドレスが未確認の利用者の変更も保存する', async () => {
    const { service, store } = setup();

    const view = await service.update(
      currentUserOf({ emailVerifiedAt: null }),
      'followed_user_award',
      true,
      NOW,
    );

    expect(store.saved).toHaveLength(1);
    expect(view.preferences.get('followed_user_award')).toBe(true);
    expect(view.emailVerified).toBe(false);
  });

  test('除外の対象の利用者の変更も保存し、除外の状態を返す', async () => {
    const { service, store } = setup({
      delivery: { kind: 'suppressed', reason: 'complaint', until: null },
    });

    const view = await service.update(
      currentUserOf(),
      'match_preview',
      true,
      NOW,
    );

    expect(store.saved).toHaveLength(1);
    expect(view.delivery).toEqual({
      kind: 'suppressed',
      reason: 'complaint',
      until: null,
    });
  });

  test('配信の状態の照会が失敗しても変更を保存し、unknownを返す', async () => {
    const { service, store } = setup({ delivery: new Error('照会の失敗') });

    const view = await service.update(
      currentUserOf(),
      'match_preview',
      true,
      NOW,
    );

    expect(store.saved).toHaveLength(1);
    expect(view.delivery).toEqual({ kind: 'unknown' });
  });

  test.each([
    ['停止中', { status: 'suspended' }],
    ['退会済み', { deletedAt: NOW }],
  ] as const)(
    '%sの利用者の変更はaccount_unavailableで拒否し、保存しない',
    async (_label, overrides) => {
      const { service, store } = setup();

      const error = await service
        .update(currentUserOf(overrides), 'match_preview', true, NOW)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('account_unavailable');
      expect(store.saved).toEqual([]);
    },
  );

  test('保存の失敗はそのまま投げる', async () => {
    const { store } = setup();
    const failure = new Error('保存の失敗');
    const failing: NotificationPreferenceStore = {
      ...store,
      setPreference: () => Promise.reject(failure),
    };

    const error = await new StoreNotificationSettingsService(
      failing,
      createDeliveryStatusReader({ kind: 'deliverable' }),
    )
      .update(currentUserOf(), 'match_preview', true, NOW)
      .catch((e: unknown) => e);

    expect(error).toBe(failure);
  });
});

describe('StoreNotificationSettingsServiceの注入', () => {
  test('受信設定のストアと配信の状態の照会を識別子で注入して解決できる', async () => {
    const { store, reader } = setup({ preferences: { match_preview: true } });
    const container = new Container();
    container
      .bind<NotificationPreferenceStore>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
      )
      .toConstantValue(store);
    container
      .bind<DeliveryStatusReader>(NOTIFICATIONS_TYPES.DeliveryStatusReader)
      .toConstantValue(reader);
    container
      .bind<NotificationSettingsService>(
        NOTIFICATIONS_TYPES.NotificationSettingsService,
      )
      .to(StoreNotificationSettingsService);

    const service = container.get<NotificationSettingsService>(
      NOTIFICATIONS_TYPES.NotificationSettingsService,
    );

    expect(service).toBeInstanceOf(StoreNotificationSettingsService);
    expect(await service.read(currentUserOf())).toMatchObject({
      preferences: allTopics({ match_preview: true }),
    });
  });
});
