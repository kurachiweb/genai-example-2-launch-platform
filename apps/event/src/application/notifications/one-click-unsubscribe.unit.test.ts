import { describe, expect, test } from 'bun:test';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTarget,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';
import {
  OneClickUnsubscribe,
  type OneClickUnsubscribeResult,
} from './one-click-unsubscribe.ts';

const USER_ID = '01JC0RCPT00000000000000001';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const VALID_TOKEN = 'valid-token';

const UNKNOWN_TOKEN = 'unknown-token';

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

// 処理が投げた例外を返し、例外にならなければテストを失敗させる
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('処理が例外にならなかった');
}

const unused = (): never => {
  throw new Error('トークンによる停止では使わない');
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

function createUseCase(
  topic: NotificationTopic,
  initial: Partial<Record<NotificationTopic, boolean>>,
): {
  readonly useCase: OneClickUnsubscribe;
  readonly preferences: FakePreferenceStore;
  readonly tokens: FakeTokenService;
} {
  const preferences = createPreferenceStore(initial);
  const tokens = createTokenService({ userId: USER_ID, topic });
  return {
    useCase: new OneClickUnsubscribe(tokens, preferences),
    preferences,
    tokens,
  };
}

describe('OneClickUnsubscribe', () => {
  test('照合できないトークンは無効を返し、受信設定を読まず変えない', async () => {
    const { useCase, preferences, tokens } = createUseCase('match_result', {
      match_result: true,
    });

    const result = await useCase.execute(UNKNOWN_TOKEN, NOW);

    expect(result).toStrictEqual({ kind: 'invalid' });
    expect(tokens.resolved).toStrictEqual([UNKNOWN_TOKEN]);
    expect(preferences.read).toStrictEqual([]);
    expect(preferences.saved).toStrictEqual([]);
  });

  test('受信する設定なら、トークンの組の種別の受信を処理の時刻で停止する', async () => {
    const { useCase, preferences } = createUseCase('match_result', {
      match_result: true,
    });

    const result = await useCase.execute(VALID_TOKEN, NOW);

    expect(result).toStrictEqual({
      kind: 'unsubscribed',
      topic: 'match_result',
      alreadyDisabled: false,
    });
    expect(preferences.saved).toStrictEqual([
      { userId: USER_ID, topic: 'match_result', enabled: false, at: NOW },
    ]);
  });

  test('既に停止している種別は保存せずに成功を返し、繰り返しても受信設定を変えない', async () => {
    const { useCase, preferences } = createUseCase('match_preview', {});

    const first = await useCase.execute(VALID_TOKEN, NOW);
    const second = await useCase.execute(VALID_TOKEN, NOW);

    const expected: OneClickUnsubscribeResult = {
      kind: 'unsubscribed',
      topic: 'match_preview',
      alreadyDisabled: true,
    };
    expect(first).toStrictEqual(expected);
    expect(second).toStrictEqual(expected);
    expect(preferences.saved).toStrictEqual([]);
  });

  test('同じトークンの2回目は停止済みとして保存しない', async () => {
    const { useCase, preferences } = createUseCase('followed_user_award', {
      followed_user_award: true,
    });

    await useCase.execute(VALID_TOKEN, NOW);
    const second = await useCase.execute(VALID_TOKEN, NOW);

    expect(second).toStrictEqual({
      kind: 'unsubscribed',
      topic: 'followed_user_award',
      alreadyDisabled: true,
    });
    expect(preferences.saved).toHaveLength(1);
  });

  test('停止だけを行い、他の種別の受信設定と受信の再開に触れない', async () => {
    const { useCase, preferences } = createUseCase('followed_user_match', {
      match_preview: true,
      match_result: true,
      followed_user_match: true,
      followed_user_award: true,
    });

    await useCase.execute(VALID_TOKEN, NOW);

    expect(preferences.saved.every(({ enabled }) => !enabled)).toBe(true);
    expect(Object.fromEntries(preferences.current())).toStrictEqual({
      match_preview: true,
      match_result: true,
      followed_user_match: false,
      followed_user_award: true,
    });
  });

  test('受信設定の保存の失敗はそのまま投げる', async () => {
    const failure = new Error('D1の書き込みに失敗');
    const preferences: NotificationPreferenceStore = {
      ...createPreferenceStore({ match_result: true }),
      setPreference: () => Promise.reject(failure),
    };
    const useCase = new OneClickUnsubscribe(
      createTokenService({ userId: USER_ID, topic: 'match_result' }),
      preferences,
    );

    expect(await failureOf(useCase.execute(VALID_TOKEN, NOW))).toBe(failure);
  });
});
