import { describe, expect, test } from 'bun:test';

import {
  ADMIN_AVATAR_MAX_BYTES,
  ADMIN_AVATAR_UPLOAD_PURPOSE,
} from './admin-avatar-upload.ts';

describe('管理者のプロフィール画像のアップロード', () => {
  test('用途の名前はadmin-avatarにする', () => {
    expect(ADMIN_AVATAR_UPLOAD_PURPOSE).toBe('admin-avatar');
  });

  test('上限は500kBを1kB=1,024バイトとみなした512,000バイトにする', () => {
    expect(ADMIN_AVATAR_MAX_BYTES).toBe(512_000);
  });
});
