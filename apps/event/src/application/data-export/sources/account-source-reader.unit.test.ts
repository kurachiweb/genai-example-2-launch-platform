import { describe, expect, test } from 'bun:test';

import type { ApiKeyScopes } from '../../../../common-lib/public-api/api-key-rules.ts';
import type {
  AccountExport,
  AccountExportRecord,
} from '../../../../lib/core/identity/ports.ts';
import type {
  NotificationSettingsExport,
  NotificationSettingsExportRecord,
} from '../../../../lib/core/notifications/ports.ts';
import type {
  FollowExport,
  FollowExportEntry,
  ProfileExport,
  ProfileExportRecord,
} from '../../../../lib/core/profile/ports.ts';
import type {
  ApiKeyExport,
  ApiKeyExportRecord,
} from '../../../../lib/core/public-api/ports.ts';
import type {
  UltrasPlanExport,
  UltrasPlanExportItem,
} from '../../../../lib/core/ultras/ports.ts';
import { AccountSourceReader } from './account-source-reader.ts';

const USER_ID = '01JD0USER00000000000000001';
const PSEUDONYMOUS_ID = 'PSEUDONYM-SECRET-1';
const NOW = new Date('2026-11-22T00:00:00.000Z');
const REGISTERED_AT = new Date('2026-01-01T00:00:00.000Z');
const VERIFIED_AT = new Date('2026-01-02T00:00:00.000Z');
const KEY_AT = new Date('2026-02-01T00:00:00.000Z');
const FOLLOWED_AT = new Date('2026-03-01T00:00:00.000Z');
const PROFILE_AT = new Date('2026-04-01T00:00:00.000Z');
const PLAN_STARTED_AT = new Date('2026-05-01T00:00:00.000Z');
const PLAN_ENDS_AT = new Date('2026-12-01T00:00:00.000Z');
const SCOPES: ApiKeyScopes = {
  products: 'read',
  launches: 'read',
  upvotes: 'none',
  comments: 'read',
  ratings: 'none',
  profile: 'read_write',
  productDescriptions: 'none',
};

interface Fakes {
  readonly account: AccountExportRecord | undefined;
  readonly plan: UltrasPlanExportItem | null;
  readonly notificationSettings: NotificationSettingsExportRecord | undefined;
  readonly apiKeys: readonly ApiKeyExportRecord[];
  readonly profile: ProfileExportRecord | undefined;
  readonly follows: readonly FollowExportEntry[];
}

interface Calls {
  readonly account: string[];
  readonly plan: [string, Date][];
  readonly notificationSettings: string[];
  readonly apiKeys: string[];
  readonly profile: string[];
  readonly follows: string[];
}

function accountRecord(): AccountExportRecord {
  return {
    userId: USER_ID,
    pseudonymousId: PSEUDONYMOUS_ID,
    email: 'taro@user.example',
    emailVerifiedAt: VERIFIED_AT,
    registeredAt: REGISTERED_AT,
    mfaEnabled: true,
  };
}

function profileRecord(): ProfileExportRecord {
  return {
    handle: 'taro',
    nickname: '太郎',
    headline: '開発者',
    bioMarkdown: '# 自己紹介',
    avatarFileId: 'F-AVATAR-1',
    websites: [{ name: '個人サイト', url: 'https://taro.example/' }],
    updatedAt: PROFILE_AT,
  };
}

function defaults(): Fakes {
  return {
    account: accountRecord(),
    plan: {
      name: 'ultras',
      status: 'active',
      startedAt: PLAN_STARTED_AT,
      currentPeriodEndsAt: PLAN_ENDS_AT,
      canceledAt: null,
    },
    notificationSettings: {
      matchPreview: true,
      matchResult: false,
      followedUserMatch: true,
      followedUserAward: false,
      suppressedReason: 'bounce',
    },
    apiKeys: [{ name: '連携用', scopes: SCOPES, createdAt: KEY_AT }],
    profile: profileRecord(),
    follows: [{ handle: 'hanako', nickname: '花子', followedAt: FOLLOWED_AT }],
  };
}

function build(overrides: Partial<Fakes> = {}): {
  readonly reader: AccountSourceReader;
  readonly calls: Calls;
} {
  const fakes: Fakes = { ...defaults(), ...overrides };
  const calls: Calls = {
    account: [],
    plan: [],
    notificationSettings: [],
    apiKeys: [],
    profile: [],
    follows: [],
  };
  const accounts: AccountExport = {
    find: (userId) => {
      calls.account.push(userId);
      return Promise.resolve(fakes.account);
    },
  };
  const plans: UltrasPlanExport = {
    find: (userId, now) => {
      calls.plan.push([userId, now]);
      return Promise.resolve(fakes.plan);
    },
  };
  const notificationSettings: NotificationSettingsExport = {
    find: (userId) => {
      calls.notificationSettings.push(userId);
      return Promise.resolve(fakes.notificationSettings);
    },
  };
  const apiKeys: ApiKeyExport = {
    listByUser: (userId) => {
      calls.apiKeys.push(userId);
      return Promise.resolve(fakes.apiKeys);
    },
  };
  const profiles: ProfileExport = {
    find: (userId) => {
      calls.profile.push(userId);
      return Promise.resolve(fakes.profile);
    },
  };
  const follows: FollowExport = {
    listFollowing: (userId) => {
      calls.follows.push(userId);
      return Promise.resolve(fakes.follows);
    },
  };
  return {
    reader: new AccountSourceReader(
      accounts,
      plans,
      notificationSettings,
      apiKeys,
      profiles,
      follows,
    ),
    calls,
  };
}

describe('AccountSourceReader.read', () => {
  test('アカウント・Ultras・通知の設定・APIキーをスナップショットのアカウントへ写す', async () => {
    const { reader, calls } = build();

    const source = await reader.read(USER_ID, NOW);

    expect(source?.account).toStrictEqual({
      email: 'taro@user.example',
      emailVerifiedAt: VERIFIED_AT,
      registeredAt: REGISTERED_AT,
      mfaEnabled: true,
      plan: {
        status: 'active',
        startedAt: PLAN_STARTED_AT,
        currentPeriodEndsAt: PLAN_ENDS_AT,
        canceledAt: null,
      },
      notificationSettings: {
        matchPreview: true,
        matchResult: false,
        followedUserMatch: true,
        followedUserAward: false,
        suppressedReason: 'bounce',
      },
      apiKeys: [{ name: '連携用', scopes: SCOPES, createdAt: KEY_AT }],
    });
    expect(calls.plan).toStrictEqual([[USER_ID, NOW]]);
    expect(calls.notificationSettings).toStrictEqual([USER_ID]);
    expect(calls.apiKeys).toStrictEqual([USER_ID]);
  });

  test('プロフィールとフォローをスナップショットの形へ写す', async () => {
    const { reader } = build();

    const source = await reader.read(USER_ID, NOW);

    expect(source?.profile).toStrictEqual({
      handle: 'taro',
      nickname: '太郎',
      headline: '開発者',
      bioMarkdown: '# 自己紹介',
      avatarFileId: 'F-AVATAR-1',
      websites: [{ name: '個人サイト', url: 'https://taro.example/' }],
      updatedAt: PROFILE_AT,
    });
    expect(source?.follows).toStrictEqual([
      { handle: 'hanako', nickname: '花子', followedAt: FOLLOWED_AT },
    ]);
  });

  test('仮名化IDを別の項目で返し、スナップショットの項目には入れない', async () => {
    const { reader } = build();

    const source = await reader.read(USER_ID, NOW);

    expect(source?.pseudonymousId).toBe(PSEUDONYMOUS_ID);
    expect(JSON.stringify(source?.account)).not.toContain(PSEUDONYMOUS_ID);
    expect(JSON.stringify(source?.profile)).not.toContain(PSEUDONYMOUS_ID);
    expect(JSON.stringify(source?.follows)).not.toContain(PSEUDONYMOUS_ID);
    expect(JSON.stringify(source?.account)).not.toContain(USER_ID);
  });

  test('Ultrasの加入と通知の設定が無ければそれぞれnullで、APIキーが無ければ空にする', async () => {
    const { reader } = build({
      plan: null,
      notificationSettings: undefined,
      apiKeys: [],
      follows: [],
    });

    const source = await reader.read(USER_ID, NOW);

    expect(source?.account.plan).toBeNull();
    expect(source?.account.notificationSettings).toBeNull();
    expect(source?.account.apiKeys).toStrictEqual([]);
    expect(source?.follows).toStrictEqual([]);
  });

  test('上流の余分な項目をスナップショットへ漏らさない', async () => {
    const { reader } = build({
      account: {
        ...accountRecord(),
        extra: 'leak',
      } as AccountExportRecord,
      apiKeys: [
        {
          name: '連携用',
          scopes: SCOPES,
          createdAt: KEY_AT,
          keyHash: 'leak',
        } as ApiKeyExportRecord,
      ],
      profile: { ...profileRecord(), extra: 'leak' } as ProfileExportRecord,
      follows: [
        {
          handle: 'hanako',
          nickname: '花子',
          followedAt: FOLLOWED_AT,
          extra: 'leak',
        } as FollowExportEntry,
      ],
    });

    const source = await reader.read(USER_ID, NOW);

    expect(JSON.stringify(source)).not.toContain('leak');
  });

  test('アカウントが無い(退会済み)なら何も返さず、他の部品を呼ばない', async () => {
    const { reader, calls } = build({ account: undefined });

    const source = await reader.read(USER_ID, NOW);

    expect(source).toBeUndefined();
    expect(calls.plan).toStrictEqual([]);
    expect(calls.profile).toStrictEqual([]);
    expect(calls.follows).toStrictEqual([]);
  });

  test('プロフィールが無い(退会済み)なら何も返さない', async () => {
    const { reader } = build({ profile: undefined });

    expect(await reader.read(USER_ID, NOW)).toBeUndefined();
  });

  test('部品の例外をそのまま投げる', async () => {
    const failure = new Error('フォローの取得に失敗');
    const failing = new AccountSourceReader(
      { find: () => Promise.resolve(accountRecord()) },
      { find: () => Promise.resolve(null) },
      { find: () => Promise.resolve(undefined) },
      { listByUser: () => Promise.resolve([]) },
      { find: () => Promise.resolve(profileRecord()) },
      { listFollowing: () => Promise.reject(failure) },
    );

    const caught = await failing
      .read(USER_ID, NOW)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});

describe('AccountSourceReader.exists', () => {
  test('アカウントがあれば真で、他の部品を呼ばない', async () => {
    const { reader, calls } = build();

    expect(await reader.exists(USER_ID)).toBe(true);
    expect(calls.account).toStrictEqual([USER_ID]);
    expect(calls.profile).toStrictEqual([]);
  });

  test('アカウントが無ければ偽', async () => {
    const { reader } = build({ account: undefined });

    expect(await reader.exists(USER_ID)).toBe(false);
  });

  test('部品の例外をそのまま投げる', async () => {
    const failure = new Error('アカウントの取得に失敗');
    const reader = new AccountSourceReader(
      { find: () => Promise.reject(failure) },
      { find: () => Promise.resolve(null) },
      { find: () => Promise.resolve(undefined) },
      { listByUser: () => Promise.resolve([]) },
      { find: () => Promise.resolve(undefined) },
      { listFollowing: () => Promise.resolve([]) },
    );

    const caught = await reader
      .exists(USER_ID)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
