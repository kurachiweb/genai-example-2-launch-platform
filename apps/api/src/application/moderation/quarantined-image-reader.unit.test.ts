import { describe, expect, test } from 'bun:test';

import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import type {
  MediaOwner,
  ModerationFinding,
} from '../../../lib/core/media/media-file.ts';
import type {
  MediaQuarantine,
  QuarantinedImage,
  QuarantinedImageList,
  QuarantinedImageListInput,
} from '../../../lib/core/media/ports.ts';
import type {
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import { imageFileViewOf } from '../../../test/support/media-file-view.ts';
import { DefaultQuarantinedImageReader } from './quarantined-image-reader.ts';

const USER_A = '01JQ0USR000000000000000001';
const USER_B = '01JQ0USR000000000000000002';
const ERASED_USER = '01JQ0USR000000000000000009';
const ADMIN_A = '01JQ0ADM000000000000000001';
const DELETED_ADMIN = '01JQ0ADM000000000000000009';
const QUARANTINED_AT = new Date('2026-11-20T03:00:00.000Z');

const USER_SUMMARIES: ReadonlyMap<string, UserSummaryRecord> = new Map([
  [
    USER_A,
    {
      userId: USER_A,
      handle: 'alice',
      nickname: 'アリス',
      avatarFileId: null,
      suspended: false,
    },
  ],
  [
    USER_B,
    {
      userId: USER_B,
      handle: 'bob',
      nickname: 'ボブ',
      avatarFileId: null,
      suspended: true,
    },
  ],
]);

const ADMIN_PROFILES: ReadonlyMap<string, AdminProfileView> = new Map([
  [
    ADMIN_A,
    { id: ADMIN_A, nickname: 'モデレーター', title: null, avatarFileId: null },
  ],
]);

function imageOf(
  id: string,
  owner: MediaOwner,
  overrides: Partial<QuarantinedImage> = {},
): QuarantinedImage {
  return {
    file: imageFileViewOf({
      id,
      owner,
      purpose: 'product-logo',
      quarantineReasons: ['auto', 'admin_action'],
    }),
    quarantinedAt: QUARANTINED_AT,
    findings: [],
    ...overrides,
  };
}

interface Harness {
  readonly reader: DefaultQuarantinedImageReader;
  readonly quarantineCalls: QuarantinedImageListInput[];
  readonly userCalls: {
    readonly ids: readonly string[];
    readonly scope: UserLookupScope;
  }[];
  readonly adminCalls: (readonly string[])[];
}

function harness(list: QuarantinedImageList): Harness {
  const quarantineCalls: QuarantinedImageListInput[] = [];
  const userCalls: Harness['userCalls'] = [];
  const adminCalls: (readonly string[])[] = [];
  const quarantine: Pick<MediaQuarantine, 'listByReason'> = {
    listByReason: (input) => {
      quarantineCalls.push(input);
      return Promise.resolve(list);
    },
  };
  const users: Pick<UserProfileDirectory, 'findSummaries'> = {
    findSummaries: (ids, scope) => {
      userCalls.push({ ids, scope });
      return Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const summary = USER_SUMMARIES.get(id);
            return summary === undefined ? [] : [[id, summary] as const];
          }),
        ),
      );
    },
  };
  const admins: AdminDirectory = {
    findProfiles: (ids) => {
      adminCalls.push(ids);
      return Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const profile = ADMIN_PROFILES.get(id);
            return profile === undefined ? [] : [[id, profile] as const];
          }),
        ),
      );
    },
  };
  return {
    reader: new DefaultQuarantinedImageReader(
      quarantine as MediaQuarantine,
      users as UserProfileDirectory,
      admins,
    ),
    quarantineCalls,
    userCalls,
    adminCalls,
  };
}

describe('DefaultQuarantinedImageReader', () => {
  test('隔離理由ごとに50件の上限と上流のカーソルで一覧を読み、続きのカーソルを上流のまま返す', async () => {
    const { reader, quarantineCalls } = harness({
      items: [],
      nextCursor: 'opaque-next-cursor',
    });

    const page = await reader.list({
      reason: 'admin_action',
      cursor: 'opaque-cursor',
    });

    expect(quarantineCalls).toEqual([
      { reason: 'admin_action', cursor: 'opaque-cursor', limit: 50 },
    ]);
    expect(page).toEqual({ items: [], nextCursor: 'opaque-next-cursor' });
  });

  test('続きが無ければカーソルを持たない', async () => {
    const { reader, quarantineCalls, userCalls, adminCalls } = harness({
      items: [],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(quarantineCalls).toEqual([
      { reason: 'auto', cursor: undefined, limit: 50 },
    ]);
    expect(page.nextCursor).toBeUndefined();
    expect(userCalls).toEqual([]);
    expect(adminCalls).toEqual([]);
  });

  test('上流の並びのまま、画像・用途・隔離された日時・全ての隔離理由を返す', async () => {
    const first = imageOf('01JQ0F11E000000000000000001', {
      kind: 'user',
      id: USER_A,
    });
    const second = imageOf(
      '01JQ0F11E000000000000000002',
      { kind: 'user', id: USER_A },
      { quarantinedAt: new Date('2026-11-19T03:00:00.000Z') },
    );
    const { reader } = harness({
      items: [
        first,
        {
          ...second,
          file: imageFileViewOf({
            ...second.file,
            purpose: 'user-avatar',
            quarantineReasons: ['user_suspended'],
          }),
        },
      ],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(
      page.items.map(({ file, purpose, quarantinedAt }) => ({
        file,
        purpose,
        quarantinedAt,
      })),
    ).toEqual([
      {
        file: {
          id: '01JQ0F11E000000000000000001',
          quarantined: true,
          quarantineReasons: ['auto', 'admin_action'],
        },
        purpose: 'product-logo',
        quarantinedAt: QUARANTINED_AT,
      },
      {
        file: {
          id: '01JQ0F11E000000000000000002',
          quarantined: true,
          quarantineReasons: ['user_suspended'],
        },
        purpose: 'user-avatar',
        quarantinedAt: new Date('2026-11-19T03:00:00.000Z'),
      },
    ]);
  });

  test('利用者と管理者の保有者の表示名を、重複を除いたIDでそれぞれ1回ずつまとめて照会する', async () => {
    const { reader, userCalls, adminCalls } = harness({
      items: [
        imageOf('01JQ0F11E000000000000000001', { kind: 'user', id: USER_A }),
        imageOf('01JQ0F11E000000000000000002', { kind: 'admin', id: ADMIN_A }),
        imageOf('01JQ0F11E000000000000000003', { kind: 'user', id: USER_B }),
        imageOf('01JQ0F11E000000000000000004', { kind: 'user', id: USER_A }),
        imageOf('01JQ0F11E000000000000000005', { kind: 'system' }),
      ],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(userCalls).toEqual([
      { ids: [USER_A, USER_B], scope: 'including-withdrawn' },
    ]);
    expect(adminCalls).toEqual([[ADMIN_A]]);
    expect(page.items.map((item) => item.owner)).toEqual([
      { kind: 'user', id: USER_A, nickname: 'アリス', handle: 'alice' },
      { kind: 'admin', id: ADMIN_A, nickname: 'モデレーター', handle: null },
      { kind: 'user', id: USER_B, nickname: 'ボブ', handle: 'bob' },
      { kind: 'user', id: USER_A, nickname: 'アリス', handle: 'alice' },
      null,
    ]);
  });

  test('保有者がsystemの画像だけなら保有者の照会をせず、保有者を持たない', async () => {
    const { reader, userCalls, adminCalls } = harness({
      items: [imageOf('01JQ0F11E000000000000000001', { kind: 'system' })],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(page.items.map((item) => item.owner)).toEqual([null]);
    expect(userCalls).toEqual([]);
    expect(adminCalls).toEqual([]);
  });

  test('物理削除済みの利用者・削除済みの管理者は、種類とIDだけを持ち表示名を持たない', async () => {
    const { reader } = harness({
      items: [
        imageOf('01JQ0F11E000000000000000001', {
          kind: 'user',
          id: ERASED_USER,
        }),
        imageOf('01JQ0F11E000000000000000002', {
          kind: 'admin',
          id: DELETED_ADMIN,
        }),
      ],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(page.items.map((item) => item.owner)).toEqual([
      { kind: 'user', id: ERASED_USER, nickname: null, handle: null },
      { kind: 'admin', id: DELETED_ADMIN, nickname: null, handle: null },
    ]);
  });

  test.each<[string, ModerationFinding, string]>([
    [
      '画像の判定のラベルは分類・ラベル・切り捨てた信頼度',
      {
        source: 'labels',
        category: 'Violence',
        label: 'Graphic Violence',
        confidence: 97.5,
      },
      'Violence: Graphic Violence(信頼度97%)',
    ],
    [
      'SVGの違反は違反と対象',
      { source: 'svg', violation: 'disallowed_element', target: 'script' },
      'SVG: disallowed_element(script)',
    ],
    [
      '画像を読み込めなかった判定',
      { source: 'unprocessable', reason: 'undecodable' },
      '画像を読み込めないため判定できませんでした',
    ],
    [
      '判定サービスが受け付けなかった判定',
      { source: 'unprocessable', reason: 'rejected-by-service' },
      '判定サービスが画像を受け付けませんでした',
    ],
  ])('検出内容の文字列化: %s', async (_name, finding, expected) => {
    const { reader } = harness({
      items: [
        imageOf(
          '01JQ0F11E000000000000000001',
          { kind: 'system' },
          { findings: [finding] },
        ),
      ],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(page.items[0]?.findings).toEqual([expected]);
  });

  test('複数の検出内容を上流の順のまま文字列にし、検出内容が無ければ空にする', async () => {
    const { reader } = harness({
      items: [
        imageOf(
          '01JQ0F11E000000000000000001',
          { kind: 'system' },
          {
            findings: [
              {
                source: 'svg',
                violation: 'disallowed_attribute',
                target: 'onload',
              },
              {
                source: 'labels',
                category: 'Explicit',
                label: 'Nudity',
                confidence: 80,
              },
            ],
          },
        ),
        imageOf('01JQ0F11E000000000000000002', { kind: 'system' }),
      ],
      nextCursor: undefined,
    });

    const page = await reader.list({ reason: 'auto', cursor: undefined });

    expect(page.items.map((item) => item.findings)).toEqual([
      ['SVG: disallowed_attribute(onload)', 'Explicit: Nudity(信頼度80%)'],
      [],
    ]);
  });

  test('上流の照会の失敗をそのまま投げる', async () => {
    const failure = new Error('invalid cursor');
    const reader = new DefaultQuarantinedImageReader(
      {
        listByReason: () => Promise.reject(failure),
      } as Pick<MediaQuarantine, 'listByReason'> as MediaQuarantine,
      {
        findSummaries: () => Promise.resolve(new Map()),
      } as Pick<UserProfileDirectory, 'findSummaries'> as UserProfileDirectory,
      { findProfiles: () => Promise.resolve(new Map()) },
    );

    const thrown = await reader.list({ reason: 'auto', cursor: 'broken' }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
  });
});
