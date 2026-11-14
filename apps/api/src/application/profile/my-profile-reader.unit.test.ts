import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { StoreMyProfileReader } from './my-profile-reader.ts';
import {
  CURRENT_AVATAR_ID,
  createFakeProfileStore,
  currentUserOf,
  snapshotOf,
} from './testing/profile-fakes.ts';

describe('StoreMyProfileReader.read', () => {
  test('利用者のIDを除いた自分のプロフィールを返す', async () => {
    const snapshot = snapshotOf({
      previousHandle: 'old-alice',
      headline: '見出し',
      bioMarkdown: '本文',
      avatarFileId: CURRENT_AVATAR_ID,
      websites: [{ name: 'ブログ', url: 'https://blog.example' }],
      suspended: true,
    });
    const reader = new StoreMyProfileReader(
      createFakeProfileStore([], { snapshot }),
    );

    const view = await reader.read(currentUserOf());

    expect(view).toEqual({
      nickname: 'アリス',
      handle: 'alice',
      previousHandle: 'old-alice',
      headline: '見出し',
      bioMarkdown: '本文',
      avatarFileId: CURRENT_AVATAR_ID,
      websites: [{ name: 'ブログ', url: 'https://blog.example' }],
      suspended: true,
    });
    expect('userId' in view).toBe(false);
  });

  test('メールアドレスが未確認の利用者にも返す', async () => {
    const reader = new StoreMyProfileReader(createFakeProfileStore([]));

    const view = await reader.read(currentUserOf({ emailVerifiedAt: null }));

    expect(view.handle).toBe('alice');
  });

  test('利用者の行が無ければaccount_unavailableで拒否する', async () => {
    const reader = new StoreMyProfileReader(
      createFakeProfileStore([], { snapshot: undefined }),
    );

    const error = await reader.read(currentUserOf()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('account_unavailable');
  });
});
