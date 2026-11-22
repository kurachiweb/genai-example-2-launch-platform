import { describe, expect, test } from 'bun:test';

import { planArchive } from '../export-plan.ts';
import type {
  ExportAccount,
  ExportFileView,
  ExportProfile,
  ExportSnapshot,
} from '../export-snapshot.ts';
import {
  buildAccountDocument,
  buildProfileDocument,
} from './account-documents.ts';
import type { DocumentInput } from './file-reference.ts';

const AVATAR_ID = '01AVATAR0000000000000000A';

function account(overrides: Partial<ExportAccount> = {}): ExportAccount {
  return {
    email: 'kurachi@mail.example',
    emailVerifiedAt: new Date('2026-03-02T01:15:00.000Z'),
    registeredAt: new Date('2026-03-01T23:58:41.000Z'),
    mfaEnabled: true,
    plan: {
      status: 'active',
      startedAt: new Date('2026-06-01T15:00:00.000Z'),
      currentPeriodEndsAt: new Date('2026-10-01T15:00:00.000Z'),
      canceledAt: null,
    },
    notificationSettings: {
      matchPreview: true,
      matchResult: true,
      followedUserMatch: false,
      followedUserAward: true,
      suppressedReason: null,
    },
    apiKeys: [
      {
        name: 'My dashboard',
        scopes: {
          products: 'read',
          launches: 'read',
          upvotes: 'read',
          comments: 'none',
          ratings: 'read',
          profile: 'read_write',
          productDescriptions: 'read_write',
        },
        createdAt: new Date('2026-07-10T09:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function profile(overrides: Partial<ExportProfile> = {}): ExportProfile {
  return {
    handle: 'KurachiWeb',
    nickname: 'Kurachi',
    headline: '個人開発者。SaaSを週1でローンチ中',
    bioMarkdown: '# 自己紹介',
    avatarFileId: AVATAR_ID,
    websites: [
      { name: 'GitHub', url: 'https://github.example/kurachi' },
      { name: 'Blog', url: 'https://blog.example/' },
    ],
    updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    ...overrides,
  };
}

function avatarView(overrides: Partial<ExportFileView> = {}): ExportFileView {
  return {
    fileId: AVATAR_ID,
    originalFileName: 'avatar.png',
    contentType: 'image/png',
    byteSize: 92_416,
    quarantined: false,
    ...overrides,
  };
}

function documentInput(
  overrides: {
    readonly account?: ExportAccount;
    readonly profile?: ExportProfile;
    readonly views?: readonly ExportFileView[];
    readonly storeAll?: boolean;
  } = {},
): DocumentInput {
  const views = overrides.views ?? [avatarView()];
  const snapshot: ExportSnapshot = {
    requestedAt: new Date('2026-09-15T10:12:30.000Z'),
    account: overrides.account ?? account(),
    profile: overrides.profile ?? profile(),
    products: [],
    launches: [],
    comments: [],
    upvotes: [],
    ratings: [],
    follows: [],
    reports: [],
    inquiries: [],
    sponsorships: [],
    payments: [],
    files: new Map(views.map((view) => [view.fileId, view])),
  };
  const plan = planArchive(snapshot);
  const stored =
    overrides.storeAll === false
      ? new Set<string>()
      : new Set(plan.binaries.map((binary) => binary.fileId));
  return { snapshot, plan, stored };
}

describe('buildAccountDocument', () => {
  test('文書の例と同じ項目名・値で出力する', () => {
    const document = buildAccountDocument(documentInput());

    expect(document).toStrictEqual({
      email: 'kurachi@mail.example',
      emailVerifiedAt: '2026-03-02T01:15:00.000Z',
      registeredAt: '2026-03-01T23:58:41.000Z',
      mfaEnabled: true,
      plan: {
        name: 'ultras',
        status: 'active',
        startedAt: '2026-06-01T15:00:00.000Z',
        currentPeriodEndsAt: '2026-10-01T15:00:00.000Z',
        canceledAt: null,
      },
      notificationSettings: {
        matchPreview: true,
        matchResult: true,
        followedUserMatch: false,
        followedUserAward: true,
        suppressedReason: null,
      },
      apiKeys: [
        {
          name: 'My dashboard',
          scopes: {
            products: 'read',
            launches: 'read',
            upvotes: 'read',
            comments: 'none',
            ratings: 'read',
            profile: 'read_write',
            productDescriptions: 'read_write',
          },
          createdAt: '2026-07-10T09:00:00.000Z',
        },
      ],
    });
  });

  test('項目の順が文書と同じである', () => {
    const document = buildAccountDocument(documentInput());

    expect(Object.keys(document)).toStrictEqual([
      'email',
      'emailVerifiedAt',
      'registeredAt',
      'mfaEnabled',
      'plan',
      'notificationSettings',
      'apiKeys',
    ]);
    expect(Object.keys(document.plan ?? {})).toStrictEqual([
      'name',
      'status',
      'startedAt',
      'currentPeriodEndsAt',
      'canceledAt',
    ]);
    expect(Object.keys(document.notificationSettings ?? {})).toStrictEqual([
      'matchPreview',
      'matchResult',
      'followedUserMatch',
      'followedUserAward',
      'suppressedReason',
    ]);
    expect(Object.keys(document.apiKeys[0] ?? {})).toStrictEqual([
      'name',
      'scopes',
      'createdAt',
    ]);
  });

  test('加入の履歴が無いときplanをnullにする', () => {
    const document = buildAccountDocument(
      documentInput({ account: account({ plan: null }) }),
    );

    expect(document.plan).toBeNull();
  });

  test('解約済みの加入の解約日時と期間の終了日時を書く', () => {
    const document = buildAccountDocument(
      documentInput({
        account: account({
          plan: {
            status: 'canceled',
            startedAt: new Date('2026-06-01T15:00:00.000Z'),
            currentPeriodEndsAt: null,
            canceledAt: new Date('2026-08-01T00:00:00.123Z'),
          },
        }),
      }),
    );

    expect(document.plan).toStrictEqual({
      name: 'ultras',
      status: 'canceled',
      startedAt: '2026-06-01T15:00:00.000Z',
      currentPeriodEndsAt: null,
      canceledAt: '2026-08-01T00:00:00.123Z',
    });
  });

  test('メールアドレスの確認が済んでいなければemailVerifiedAtをnullにする', () => {
    const document = buildAccountDocument(
      documentInput({ account: account({ emailVerifiedAt: null }) }),
    );

    expect(document.emailVerifiedAt).toBeNull();
  });

  test('通知の設定の行が無ければnotificationSettingsをnullにする', () => {
    const document = buildAccountDocument(
      documentInput({ account: account({ notificationSettings: null }) }),
    );

    expect(document.notificationSettings).toBeNull();
  });

  test('送信対象外の理由をそのまま書く', () => {
    const document = buildAccountDocument(
      documentInput({
        account: account({
          notificationSettings: {
            matchPreview: false,
            matchResult: false,
            followedUserMatch: false,
            followedUserAward: false,
            suppressedReason: 'bounce',
          },
        }),
      }),
    );

    expect(document.notificationSettings?.suppressedReason).toBe('bounce');
  });

  test('APIキーが無ければ空配列にする', () => {
    const document = buildAccountDocument(
      documentInput({ account: account({ apiKeys: [] }) }),
    );

    expect(document.apiKeys).toStrictEqual([]);
  });

  test('入力に秘密情報や仮名化IDが紛れても出力へ写さない', () => {
    const polluted = {
      ...account(),
      passwordHash: 'argon2-secret',
      pseudonymousId: 'pseudo-123',
      totpSecret: 'TOTP-SECRET',
      recoveryCodes: ['recovery-1'],
      sessions: ['session-1'],
      unsubscribeToken: 'unsub-token',
      plan: {
        ...account().plan,
        pseudonymousId: 'pseudo-plan',
      },
      apiKeys: [
        {
          ...account().apiKeys[0],
          keyHash: 'hash-secret',
          plaintext: 'ls_live_plain',
        },
      ],
    } as unknown as ExportAccount;

    const text = JSON.stringify(
      buildAccountDocument(documentInput({ account: polluted })),
    );

    for (const secret of [
      'argon2-secret',
      'pseudo-123',
      'pseudo-plan',
      'TOTP-SECRET',
      'recovery-1',
      'session-1',
      'unsub-token',
      'hash-secret',
      'ls_live_plain',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('buildProfileDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildProfileDocument(documentInput());

    expect(document).toStrictEqual({
      handle: 'KurachiWeb',
      nickname: 'Kurachi',
      headline: '個人開発者。SaaSを週1でローンチ中',
      bioPath: 'profile/bio.md',
      avatarPath: 'profile/avatar/avatar.png',
      avatarQuarantined: false,
      avatarOriginalFileName: 'avatar.png',
      avatarContentType: 'image/png',
      avatarSize: 92_416,
      websites: [
        { name: 'GitHub', url: 'https://github.example/kurachi' },
        { name: 'Blog', url: 'https://blog.example/' },
      ],
      updatedAt: '2026-08-20T12:00:00.000Z',
    });
    expect(Object.keys(document)).toStrictEqual([
      'handle',
      'nickname',
      'headline',
      'bioPath',
      'avatarPath',
      'avatarQuarantined',
      'avatarOriginalFileName',
      'avatarContentType',
      'avatarSize',
      'websites',
      'updatedAt',
    ]);
  });

  test('自己紹介が未設定ならbioPathをnullにする', () => {
    const document = buildProfileDocument(
      documentInput({ profile: profile({ bioMarkdown: null }) }),
    );

    expect(document.bioPath).toBeNull();
  });

  test('自己紹介が空文字列ならbioPathをnullにする', () => {
    const document = buildProfileDocument(
      documentInput({ profile: profile({ bioMarkdown: '' }) }),
    );

    expect(document.bioPath).toBeNull();
  });

  test('ヘッドラインが未設定ならnullにする', () => {
    const document = buildProfileDocument(
      documentInput({ profile: profile({ headline: null }) }),
    );

    expect(document.headline).toBeNull();
  });

  test('プロフィール画像が未設定なら画像の項目を全てnullにする', () => {
    const document = buildProfileDocument(
      documentInput({ profile: profile({ avatarFileId: null }) }),
    );

    expect(document).toMatchObject({
      avatarPath: null,
      avatarQuarantined: null,
      avatarOriginalFileName: null,
      avatarContentType: null,
      avatarSize: null,
    });
  });

  test('隔離された画像はパスをnullにして印とメタデータを残す', () => {
    const document = buildProfileDocument(
      documentInput({ views: [avatarView({ quarantined: true })] }),
    );

    expect(document).toMatchObject({
      avatarPath: null,
      avatarQuarantined: true,
      avatarOriginalFileName: 'avatar.png',
      avatarContentType: 'image/png',
      avatarSize: 92_416,
    });
  });

  test('格納できなかった画像はパスだけをnullにする', () => {
    const document = buildProfileDocument(documentInput({ storeAll: false }));

    expect(document).toMatchObject({
      avatarPath: null,
      avatarQuarantined: false,
      avatarOriginalFileName: 'avatar.png',
      avatarSize: 92_416,
    });
  });

  test('記録の無い画像は元のファイル名・形式・バイト数・隔離の印をnullにする', () => {
    const document = buildProfileDocument(documentInput({ views: [] }));

    expect(document).toMatchObject({
      avatarPath: null,
      avatarQuarantined: null,
      avatarOriginalFileName: null,
      avatarContentType: null,
      avatarSize: null,
    });
  });

  test('外部Webサイトが無ければ空配列にし、表示名が空文字列でも残す', () => {
    const empty = buildProfileDocument(
      documentInput({ profile: profile({ websites: [] }) }),
    );
    const unnamed = buildProfileDocument(
      documentInput({
        profile: profile({
          websites: [{ name: '', url: 'https://blog.example/' }],
        }),
      }),
    );

    expect(empty.websites).toStrictEqual([]);
    expect(unnamed.websites).toStrictEqual([
      { name: '', url: 'https://blog.example/' },
    ]);
  });

  test('入力に仮名化IDが紛れても出力へ写さない', () => {
    const polluted = {
      ...profile(),
      pseudonymousId: 'pseudo-123',
      websites: [
        { name: 'GitHub', url: 'https://github.example/', id: 'site-id' },
      ],
    } as unknown as ExportProfile;

    const text = JSON.stringify(
      buildProfileDocument(documentInput({ profile: polluted })),
    );

    expect(text).not.toContain('pseudo-123');
    expect(text).not.toContain('site-id');
  });
});
