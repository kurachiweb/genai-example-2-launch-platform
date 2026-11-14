import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTarget,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';
import { NOTIFICATIONS_ERRORS } from './notifications-errors.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import {
  TokenUnsubscribeService,
  type UnsubscribeService,
} from './unsubscribe-service.ts';

const USER_ID = '01JC0RCPT00000000000000001';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const VALID_TOKEN = 'valid-token';

const INVALID_TOKEN = 'invalid-token';

interface SavedPreference {
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly enabled: boolean;
  readonly at: Date;
}

interface FakePreferenceStore extends NotificationPreferenceStore {
  readonly saved: SavedPreference[];
  readonly read: string[];
  readonly current: () => ReadonlyMap<NotificationTopic, boolean>;
}

interface FakeTokenService extends UnsubscribeTokenService {
  readonly resolved: string[];
}

const unused = (): never => {
  throw new Error('テストでは使わない');
};

function createPreferenceStore(
  initial: Partial<Record<NotificationTopic, boolean>>,
): FakePreferenceStore {
  const values = new Map<NotificationTopic, boolean>(
    NOTIFICATION_TOPICS.map((topic) => [topic, initial[topic] ?? false]),
  );
  const saved: SavedPreference[] = [];
  const read: string[] = [];
  return {
    saved,
    read,
    current: () => new Map(values),
    preferencesOf: (userId) => {
      read.push(userId);
      return Promise.resolve(new Map(values));
    },
    setPreference: (input) => {
      saved.push(input);
      values.set(input.topic, input.enabled);
      return Promise.resolve();
    },
    eligibleRecipients: unused,
    enabledTopicsOf: unused,
    deleteAllOf: unused,
  };
}

function createTokenService(target: UnsubscribeTarget): FakeTokenService {
  const resolved: string[] = [];
  return {
    resolved,
    resolve: (token) => {
      resolved.push(token);
      return Promise.resolve(token === VALID_TOKEN ? target : undefined);
    },
    tokensFor: unused,
    deleteAllOf: unused,
  };
}

function setup(
  options: {
    readonly topic?: NotificationTopic;
    readonly preferences?: Partial<Record<NotificationTopic, boolean>>;
  } = {},
) {
  const store = createPreferenceStore(options.preferences ?? {});
  const tokens = createTokenService({
    userId: USER_ID,
    topic: options.topic ?? 'match_result',
  });
  return {
    store,
    tokens,
    service: new TokenUnsubscribeService(tokens, store),
  };
}

const allTopicsEnabled: Partial<Record<NotificationTopic, boolean>> =
  Object.fromEntries(NOTIFICATION_TOPICS.map((topic) => [topic, true]));

describe('TokenUnsubscribeService.inspect', () => {
  test('無効なトークンはnullを返し、受信設定を読まない', async () => {
    const { service, store, tokens } = setup({
      preferences: { match_result: true },
    });

    expect(await service.inspect(INVALID_TOKEN)).toBeNull();
    expect(tokens.resolved).toEqual([INVALID_TOKEN]);
    expect(store.read).toEqual([]);
    expect(store.saved).toEqual([]);
  });

  test.each([true, false])(
    '有効なトークンは組の種別と現在の受信可否(%p)だけを返す',
    async (enabled) => {
      const { service, store } = setup({
        topic: 'followed_user_award',
        preferences: { ...allTopicsEnabled, followed_user_award: enabled },
      });

      expect(await service.inspect(VALID_TOKEN)).toEqual({
        topic: 'followed_user_award',
        enabled,
      });
      expect(store.read).toEqual([USER_ID]);
    },
  );

  test('照会では受信設定を変えない', async () => {
    const { service, store } = setup({ preferences: { match_result: true } });

    await service.inspect(VALID_TOKEN);

    expect(store.saved).toEqual([]);
    expect(store.current().get('match_result')).toBe(true);
  });
});

describe('TokenUnsubscribeService.confirm', () => {
  test.each(NOTIFICATION_TOPICS)(
    '受信する設定の%sを引数の時刻で受信しない設定にし、既に停止の印を付けない',
    async (topic) => {
      const { service, store } = setup({
        topic,
        preferences: allTopicsEnabled,
      });

      const result = await service.confirm(VALID_TOKEN, NOW);

      expect(result).toEqual({ topic, alreadyDisabled: false });
      expect(store.saved).toEqual([
        { userId: USER_ID, topic, enabled: false, at: NOW },
      ]);
    },
  );

  test('組の種別だけを停止し、他の種別の受信可否を変えない', async () => {
    const { service, store } = setup({
      topic: 'match_preview',
      preferences: allTopicsEnabled,
    });

    await service.confirm(VALID_TOKEN, NOW);

    expect(store.current()).toEqual(
      new Map(
        NOTIFICATION_TOPICS.map((topic) => [topic, topic !== 'match_preview']),
      ),
    );
  });

  test('既に受信しない設定の確定は保存せずに成功し、既に停止の印を返す', async () => {
    const { service, store } = setup({
      topic: 'followed_user_match',
      preferences: { match_result: true },
    });

    const result = await service.confirm(VALID_TOKEN, NOW);

    expect(result).toEqual({
      topic: 'followed_user_match',
      alreadyDisabled: true,
    });
    expect(store.saved).toEqual([]);
  });

  test('同じトークンの確定を繰り返しても受信を再開せず、2回目は既に停止の印を返す', async () => {
    const { service, store } = setup({ preferences: { match_result: true } });

    const first = await service.confirm(VALID_TOKEN, NOW);
    const second = await service.confirm(VALID_TOKEN, NOW);

    expect(first.alreadyDisabled).toBe(false);
    expect(second.alreadyDisabled).toBe(true);
    expect(store.saved.map(({ enabled }) => enabled)).toEqual([false]);
    expect(store.current().get('match_result')).toBe(false);
  });

  test('無効なトークンの確定はinvalid_linkで拒否し、受信設定を読まず保存しない', async () => {
    const { service, store } = setup({ preferences: { match_result: true } });

    const error = await service
      .confirm(INVALID_TOKEN, NOW)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('invalid_link');
    expect((error as AppError).kind).toBe(
      NOTIFICATIONS_ERRORS.invalid_link.kind,
    );
    expect(store.read).toEqual([]);
    expect(store.saved).toEqual([]);
  });

  test('保存の失敗はそのまま投げる', async () => {
    const { store, tokens } = setup({ preferences: { match_result: true } });
    const failure = new Error('保存の失敗');
    const failing: NotificationPreferenceStore = {
      ...store,
      setPreference: () => Promise.reject(failure),
    };

    const error = await new TokenUnsubscribeService(tokens, failing)
      .confirm(VALID_TOKEN, NOW)
      .catch((e: unknown) => e);

    expect(error).toBe(failure);
  });
});

describe('TokenUnsubscribeServiceの注入', () => {
  test('配信停止のトークンのサービスと受信設定のストアを識別子で注入して解決できる', async () => {
    const { store, tokens } = setup({ preferences: { match_result: true } });
    const container = new Container();
    container
      .bind<UnsubscribeTokenService>(
        NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
      )
      .toConstantValue(tokens);
    container
      .bind<NotificationPreferenceStore>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
      )
      .toConstantValue(store);
    container
      .bind<UnsubscribeService>(NOTIFICATIONS_TYPES.UnsubscribeService)
      .to(TokenUnsubscribeService);

    const service = container.get<UnsubscribeService>(
      NOTIFICATIONS_TYPES.UnsubscribeService,
    );

    expect(service).toBeInstanceOf(TokenUnsubscribeService);
    expect(await service.inspect(VALID_TOKEN)).toEqual({
      topic: 'match_result',
      enabled: true,
    });
  });
});
