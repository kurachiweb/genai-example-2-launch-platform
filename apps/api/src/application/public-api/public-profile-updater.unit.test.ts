import { describe, expect, test } from 'bun:test';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { MyProfileReader } from '../profile/my-profile-reader.ts';
import type { MyProfileView } from '../profile/ports.ts';
import type {
  ProfileEditor,
  ProfileUpdateInput,
} from '../profile/profile-editor.ts';
import { profileError } from '../profile/profile-errors.ts';
import {
  CURRENT_AVATAR_ID,
  currentUserOf,
  snapshotOf,
} from '../profile/testing/profile-fakes.ts';
import {
  composeProfileUpdate,
  EditorPublicProfileUpdater,
} from './public-profile-updater.ts';

const CURRENT: MyProfileView = {
  ...snapshotOf({
    nickname: 'アリス',
    handle: 'alice',
    previousHandle: 'alice-old',
    headline: '個人開発者',
    bioMarkdown: '**自己紹介**',
    avatarFileId: CURRENT_AVATAR_ID,
    websites: [
      { name: 'GitHub', url: 'https://github.example/alice' },
      { name: null, url: 'https://blog.example/' },
    ],
  }),
};

const UPDATED: MyProfileView = { ...CURRENT, nickname: '新しいアリス' };

function setup(
  options: {
    readonly current?: MyProfileView;
    readonly failure?: AppError;
  } = {},
) {
  const reads: CurrentUser[] = [];
  const updates: { user: CurrentUser; input: ProfileUpdateInput }[] = [];
  const reader: MyProfileReader = {
    read: (user) => {
      reads.push(user);
      return Promise.resolve(options.current ?? CURRENT);
    },
  };
  const editor: ProfileEditor = {
    update: (user, input) => {
      updates.push({ user, input });
      return options.failure === undefined
        ? Promise.resolve(UPDATED)
        : Promise.reject(options.failure);
    },
  };
  return {
    updater: new EditorPublicProfileUpdater(reader, editor),
    reads,
    updates,
  };
}

describe('composeProfileUpdate', () => {
  test('指定の無い項目と画像は現在の値で埋め、旧ハンドルの確認の値を現在のハンドルにする', () => {
    expect(composeProfileUpdate(CURRENT, { nickname: '新しいアリス' })).toEqual(
      {
        nickname: '新しいアリス',
        handle: 'alice',
        expectedHandle: 'alice',
        headline: '個人開発者',
        bioMarkdown: '**自己紹介**',
        avatarFileId: CURRENT_AVATAR_ID,
        websites: [
          { name: 'GitHub', url: 'https://github.example/alice' },
          { name: null, url: 'https://blog.example/' },
        ],
      },
    );
  });

  test('指定の項目だけを上書きし、nullの指定はヘッドラインと自己紹介を消す', () => {
    expect(
      composeProfileUpdate(CURRENT, {
        handle: 'alice-new',
        headline: null,
        bioMarkdown: null,
        websites: [],
      }),
    ).toEqual({
      nickname: 'アリス',
      handle: 'alice-new',
      expectedHandle: 'alice',
      headline: null,
      bioMarkdown: null,
      avatarFileId: CURRENT_AVATAR_ID,
      websites: [],
    });
  });

  test('画像の無いプロフィールは画像の無いまま保つ', () => {
    expect(
      composeProfileUpdate(
        { ...CURRENT, avatarFileId: null },
        { headline: '新しいヘッドライン' },
      ),
    ).toMatchObject({ avatarFileId: null, headline: '新しいヘッドライン' });
  });
});

describe('EditorPublicProfileUpdater', () => {
  test('現在のプロフィールを読み、合成した全項目でプロフィールの保存を呼び、保存の結果を返す', async () => {
    const { updater, reads, updates } = setup();
    const user = currentUserOf();

    const result = await updater.update(user, {
      bioMarkdown: '新しい自己紹介',
    });

    expect(result).toBe(UPDATED);
    expect(reads).toEqual([user]);
    expect(updates).toEqual([
      {
        user,
        input: {
          nickname: 'アリス',
          handle: 'alice',
          expectedHandle: 'alice',
          headline: '個人開発者',
          bioMarkdown: '新しい自己紹介',
          avatarFileId: CURRENT_AVATAR_ID,
          websites: CURRENT.websites,
        },
      },
    ]);
  });

  test('保存のエラー(ハンドルの重複など)は変えずにそのまま投げる', async () => {
    const failure = profileError('handle_unavailable');
    const { updater } = setup({ failure });

    const thrown = await updater
      .update(currentUserOf(), { handle: 'taken' })
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
  });
});
