import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { adminError } from './admin-errors.ts';
import type { AdminAccountStore, AdminRecord } from './ports.ts';

// 認可の後に削除された管理者を本人確認に進ませないよう、本人確認に要るパスワードのハッシュとメールアドレスを有効な管理者の行から読み直す
export async function requireOperatorRecord(
  admins: AdminAccountStore,
  current: CurrentAdmin,
): Promise<AdminRecord> {
  const admin = await admins.findById(current.id);
  if (admin?.status !== 'active') {
    throw adminError('unauthenticated');
  }
  return admin;
}
