import type { AdminAccount } from '../../graphql/admin-accounts.ts';

// 招待の完了前の管理者はニックネームを持たないため、メールアドレスで呼ぶ
export const adminAccountLabelOf = ({
  nickname,
  email,
}: Pick<AdminAccount, 'nickname' | 'email'>): string => nickname ?? email;
