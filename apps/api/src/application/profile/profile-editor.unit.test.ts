import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  CURRENT_AVATAR_ID,
  createFakeMediaFiles,
  createFakeProfileStore,
  currentUserOf,
  type FakeMediaFilesOptions,
  type FakeProfileStoreOptions,
  fixedClock,
  NEW_AVATAR_ID,
  PROFILE_NOW,
  snapshotOf,
  USER_ID,
} from './testing/profile-fakes.ts';
import {
  StoreProfileEditor,
  type ProfileUpdateInput,
} from './profile-editor.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const inputOf = (
  overrides: Partial<ProfileUpdateInput> = {},
): ProfileUpdateInput => ({
  nickname: 'アリス',
  handle: 'alice',
  expectedHandle: 'alice',
  headline: null,
  bioMarkdown: null,
  avatarFileId: null,
  websites: [],
  ...overrides,
});

function setup(
  storeOptions: FakeProfileStoreOptions = {},
  mediaOptions: FakeMediaFilesOptions = {},
) {
  const calls: string[] = [];
  const store = createFakeProfileStore(calls, storeOptions);
  const fakeMedia = createFakeMediaFiles(calls, mediaOptions);
  const editor = new StoreProfileEditor(store, fakeMedia.media, fixedClock);
  return { editor, store, calls, ...fakeMedia };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

describe('StoreProfileEditor.update の判定の順序', () => {
  test('読み込んだ時点のハンドルの照合、予約語、使用中、画像の紐付け、保存、以前の画像の削除の順に進み、保存後の内容を返す', async () => {
    const { editor, calls, claims, erased } = setup({
      snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }),
    });

    const view = await editor.update(
      currentUserOf(),
      inputOf({
        nickname: '新しい名前',
        handle: 'alice2',
        avatarFileId: NEW_AVATAR_ID,
      }),
    );

    expect(calls).toEqual([
      'store.findSnapshot',
      'store.isHandleOccupied',
      'media.claim',
      'store.save',
      'media.eraseNow',
      'store.findSnapshot',
    ]);
    expect(claims).toEqual([
      {
        fileIds: [NEW_AVATAR_ID],
        purpose: 'user-avatar',
        owner: { kind: 'user', id: USER_ID },
      },
    ]);
    expect(erased).toEqual([[CURRENT_AVATAR_ID]]);
    expect(view).toEqual({
      nickname: '新しい名前',
      handle: 'alice2',
      previousHandle: 'alice',
      headline: null,
      bioMarkdown: null,
      avatarFileId: NEW_AVATAR_ID,
      websites: [],
      suspended: false,
    });
  });

  test('保存には読み込んだ時点のハンドルと変更の計画と整えた外部Webサイトと時刻を渡し、他人の現在のハンドルの使用中は本人を除いて問い合わせる', async () => {
    const { editor, store } = setup();

    await editor.update(
      currentUserOf(),
      inputOf({
        handle: 'alice2',
        headline: '見出し',
        bioMarkdown: '本文',
        websites: [
          { name: '  ブログ  ', url: ' https://blog.example ' },
          { name: '   ', url: 'https://site.example' },
        ],
      }),
    );

    expect(store.occupiedQueries).toEqual([
      { handle: 'alice2', options: { exceptUserId: USER_ID } },
    ]);
    expect(store.saves).toEqual([
      {
        userId: USER_ID,
        expectedHandle: 'alice',
        nickname: 'アリス',
        plan: {
          handle: { kind: 'changed', next: 'alice2', previous: 'alice' },
          avatar: { kind: 'keep' },
        },
        handle: 'alice2',
        headline: '見出し',
        bioMarkdown: '本文',
        avatarFileId: null,
        websites: [
          { name: 'ブログ', url: 'https://blog.example' },
          { name: null, url: 'https://site.example' },
        ],
        now: PROFILE_NOW,
      },
    ]);
  });
});

describe('StoreProfileEditor.update の読み込んだ時点のハンドルの照合', () => {
  test.each([
    ['別のハンドル', 'bob'],
    ['大文字小文字だけが違う表記', 'Alice'],
  ])(
    '画面を開いた時点のハンドルが%sなら、何も判定せずprofile_update_conflictで拒否する',
    async (_label, expectedHandle) => {
      const { editor, calls } = setup();

      const error = await rejectionOf(
        editor.update(currentUserOf(), inputOf({ expectedHandle })),
      );

      expect(error.kind).toBe('conflict');
      expect(error.code).toBe('profile_update_conflict');
      expect(calls).toEqual(['store.findSnapshot']);
    },
  );

  test('利用者の行が無ければaccount_unavailableで拒否する', async () => {
    const { editor, calls } = setup({ snapshot: undefined });

    const error = await rejectionOf(editor.update(currentUserOf(), inputOf()));

    expect(error.kind).toBe('forbidden');
    expect(error.code).toBe('account_unavailable');
    expect(calls).toEqual(['store.findSnapshot']);
  });
});

describe('StoreProfileEditor.update のハンドルの判定', () => {
  test.each([
    ['予約語', 'admin'],
    ['大文字を含む予約語', 'Support'],
  ])(
    '変更後が%sならhandle_unavailableで拒否し、使用中の問い合わせも紐付けも保存もしない',
    async (_label, handle) => {
      const { editor, calls } = setup();

      const error = await rejectionOf(
        editor.update(currentUserOf(), inputOf({ handle })),
      );

      expect(error.kind).toBe('conflict');
      expect(error.code).toBe('handle_unavailable');
      expect(error.details).toEqual([
        {
          field: 'handle',
          code: 'unavailable',
          message:
            'このハンドルは既に使われています。別の文字列を入力してください。',
        },
      ]);
      expect(calls).toEqual(['store.findSnapshot']);
    },
  );

  test('変更後が他人の現在のハンドルなら、画像を紐付けずhandle_unavailableで拒否する', async () => {
    const { editor, calls } = setup({ occupiedHandles: ['bob'] });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ handle: 'BOB', avatarFileId: NEW_AVATAR_ID }),
      ),
    );

    expect(error.code).toBe('handle_unavailable');
    expect(calls).toEqual(['store.findSnapshot', 'store.isHandleOccupied']);
  });

  test('大文字小文字だけの変更は予約語にも使用中にも当たらず、保存へ進む', async () => {
    const { editor, store } = setup({
      snapshot: snapshotOf({ handle: 'Admin' }),
      occupiedHandles: ['admin'],
    });

    await editor.update(
      currentUserOf(),
      inputOf({ handle: 'ADMIN', expectedHandle: 'Admin' }),
    );

    expect(store.occupiedQueries).toEqual([]);
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.plan.handle).toEqual({
      kind: 'case-only',
      next: 'ADMIN',
    });
  });

  test('現在の値を変えない保存は予約語にも使用中にも当たらず、保存へ進む', async () => {
    const { editor, store } = setup({
      snapshot: snapshotOf({ handle: 'support' }),
      occupiedHandles: ['support'],
    });

    await editor.update(
      currentUserOf(),
      inputOf({ handle: 'support', expectedHandle: 'support' }),
    );

    expect(store.occupiedQueries).toEqual([]);
    expect(store.saves[0]?.plan.handle).toEqual({ kind: 'none' });
  });

  test('自分の旧ハンドルへの戻しは予約語にも使用中にも当たらず、現在のハンドルを旧ハンドルにして保存へ進む', async () => {
    const { editor, store, calls } = setup({
      snapshot: snapshotOf({ handle: 'alice2', previousHandle: 'Alice' }),
      occupiedHandles: ['alice'],
    });

    const view = await editor.update(
      currentUserOf(),
      inputOf({ handle: 'alice', expectedHandle: 'alice2' }),
    );

    expect(store.occupiedQueries).toEqual([]);
    expect(calls).toContain('store.save');
    expect(store.saves[0]?.plan.handle).toEqual({
      kind: 'changed',
      next: 'alice',
      previous: 'alice2',
    });
    expect(view.handle).toBe('alice');
    expect(view.previousHandle).toBe('alice2');
  });

  test('他人の旧ハンドルと同じ文字列は拒否せず、他人の現在のハンドルだけを使用中として保存へ進む', async () => {
    const { editor, store } = setup({ occupiedHandles: ['bob-current'] });

    const view = await editor.update(
      currentUserOf(),
      inputOf({ handle: 'bob-previous' }),
    );

    expect(store.occupiedQueries).toEqual([
      { handle: 'bob-previous', options: { exceptUserId: USER_ID } },
    ]);
    expect(store.saves).toHaveLength(1);
    expect(view.handle).toBe('bob-previous');
  });
});

describe('StoreProfileEditor.update の保存の結果', () => {
  test.each([
    ['handle-unavailable', 'conflict', 'handle_unavailable'],
    ['conflict', 'conflict', 'profile_update_conflict'],
    ['account-unavailable', 'forbidden', 'account_unavailable'],
  ] as const)(
    '保存が%sなら%s(%s)で拒否し、以前の画像を削除しない',
    async (saveResult, kind, code) => {
      const { editor, erased, markedDeleted } = setup({
        snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }),
        saveResult,
      });

      const error = await rejectionOf(
        editor.update(
          currentUserOf(),
          inputOf({ handle: 'alice2', avatarFileId: NEW_AVATAR_ID }),
        ),
      );

      expect(error.kind).toBe(kind);
      expect(error.code).toBe(code);
      expect(erased).toEqual([]);
      expect(markedDeleted).toEqual([]);
    },
  );

  test('保存の後に利用者の行が無くなっていればaccount_unavailableで拒否する', async () => {
    const calls: string[] = [];
    const base = createFakeProfileStore(calls);
    let reads = 0;
    const store = {
      ...base,
      findSnapshot: async (userId: string) => {
        reads += 1;
        return reads === 1 ? await base.findSnapshot(userId) : undefined;
      },
    };
    const { media } = createFakeMediaFiles(calls);
    const editor = new StoreProfileEditor(store, media, fixedClock);

    const error = await rejectionOf(editor.update(currentUserOf(), inputOf()));

    expect(error.code).toBe('account_unavailable');
  });
});

describe('StoreProfileEditor.update の画像', () => {
  test('画像の紐付けに失敗したらinvalid_uploadで拒否し、保存しない', async () => {
    const { editor, calls, erased } = setup(
      { snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }) },
      {
        claimResult: {
          ok: false,
          failures: [{ fileId: NEW_AVATAR_ID, reason: 'owner_mismatch' }],
        },
      },
    );

    const error = await rejectionOf(
      editor.update(currentUserOf(), inputOf({ avatarFileId: NEW_AVATAR_ID })),
    );

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('invalid_upload');
    expect(error.message).toBe('プロフィール画像をもう一度選択してください。');
    expect(calls).toEqual(['store.findSnapshot', 'media.claim']);
    expect(erased).toEqual([]);
  });

  test('画像を維持する保存は紐付けも削除もしない', async () => {
    const { editor, calls } = setup({
      snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }),
    });

    await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: CURRENT_AVATAR_ID }),
    );

    expect(calls).toEqual([
      'store.findSnapshot',
      'store.save',
      'store.findSnapshot',
    ]);
  });

  test('以前の画像が無い状態で画像を設定しても、物理削除も削除の依頼もしない', async () => {
    const { editor, erased, markedDeleted } = setup();

    await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: NEW_AVATAR_ID }),
    );

    expect(erased).toEqual([]);
    expect(markedDeleted).toEqual([]);
  });

  test('画像の差し替えは以前の画像を直ちに物理削除させ、削除の依頼はしない', async () => {
    const { editor, erased, markedDeleted } = setup({
      snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }),
    });

    await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: NEW_AVATAR_ID }),
    );

    expect(erased).toEqual([[CURRENT_AVATAR_ID]]);
    expect(markedDeleted).toEqual([]);
  });

  test('画像の削除は以前の画像に14日後の削除を依頼し、紐付けも物理削除もしない', async () => {
    const { editor, claims, erased, markedDeleted } = setup({
      snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }),
    });

    const view = await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: null }),
    );

    expect(markedDeleted).toEqual([[CURRENT_AVATAR_ID]]);
    expect(claims).toEqual([]);
    expect(erased).toEqual([]);
    expect(view.avatarFileId).toBeNull();
  });

  test('物理削除に失敗しても保存の結果を変えず、例外とファイルのIDだけを添えてwarningを記録する', async () => {
    const { editor } = setup(
      { snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }) },
      { eraseNowError: new Error('保存先の障害') },
    );

    const view = await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: NEW_AVATAR_ID }),
    );

    expect(view.avatarFileId).toBe(NEW_AVATAR_ID);
    const warnings = records.filter((record) => record.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'application', 'profile']);
    expect(Object.keys(warnings[0]?.properties ?? {}).toSorted()).toEqual([
      'error',
      'fileId',
    ]);
    expect(warnings[0]?.properties['fileId']).toBe(CURRENT_AVATAR_ID);
  });

  test('削除の依頼に失敗しても保存の結果を変えず、例外とファイルのIDだけを添えてwarningを記録する', async () => {
    const { editor } = setup(
      { snapshot: snapshotOf({ avatarFileId: CURRENT_AVATAR_ID }) },
      { markDeletedError: new Error('保存先の障害') },
    );

    const view = await editor.update(
      currentUserOf(),
      inputOf({ avatarFileId: null }),
    );

    expect(view.avatarFileId).toBeNull();
    const warnings = records.filter((record) => record.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties['fileId']).toBe(CURRENT_AVATAR_ID);
    expect(Object.keys(warnings[0]?.properties ?? {}).toSorted()).toEqual([
      'error',
      'fileId',
    ]);
  });
});

describe('StoreProfileEditor.update の利用者の状態', () => {
  test('メールアドレスが未確認の利用者の保存も拒否しない', async () => {
    const { editor, store } = setup();

    await editor.update(
      currentUserOf({ emailVerifiedAt: null }),
      inputOf({ nickname: '未確認の利用者' }),
    );

    expect(store.saves).toHaveLength(1);
  });

  test('セッションではなく引数の利用者のIDで読み取りと保存をする', async () => {
    const otherId = '01JC0USER00000000000000009';
    const { editor, store } = setup({
      snapshot: snapshotOf({ userId: otherId }),
    });

    await editor.update(currentUserOf({ id: otherId }), inputOf());

    expect(store.saves[0]?.userId).toBe(otherId);
  });
});
