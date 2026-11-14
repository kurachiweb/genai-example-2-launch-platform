import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { identityError } from './identity-errors.ts';
import type { UserAccountStore, UserRecord } from './ports.ts';

// ログイン中の利用者の確認は別の機能へも渡す読み取りの形だけを返すため、パスワードのハッシュや版を使う操作は保存済みの利用者を読み直す
export async function loadCurrentUserRecord(
  users: Pick<UserAccountStore, 'findById'>,
  current: CurrentUser,
): Promise<UserRecord> {
  const user = await users.findById(current.user.id);
  if (user === undefined || user.deletedAt !== null) {
    throw identityError('unauthenticated');
  }
  return user;
}
