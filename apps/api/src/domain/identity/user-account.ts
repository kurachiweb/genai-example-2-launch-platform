export type AccountStatus = 'active' | 'suspended';

export interface UserAccountSnapshot {
  readonly id: string;
  readonly status: AccountStatus;
  readonly emailVerifiedAt: Date | null;
  readonly deletedAt: Date | null;
}

export type AccountDenial = 'withdrawn' | 'suspended' | 'email-not-verified';

export interface AccountWritableOptions {
  readonly requireVerifiedEmail: boolean;
}

const isWithdrawn = (user: UserAccountSnapshot): boolean =>
  user.deletedAt !== null;

export const isVisibleUser = (user: UserAccountSnapshot): boolean =>
  !isWithdrawn(user) && user.status === 'active';

export const canViewOwnProfile = (
  user: UserAccountSnapshot,
  viewerUserId: string | undefined,
): boolean => {
  if (isVisibleUser(user)) {
    return true;
  }
  return (
    !isWithdrawn(user) &&
    user.status === 'suspended' &&
    viewerUserId !== undefined &&
    viewerUserId === user.id
  );
};

// 退会は停止中も受け付けるため、退会の処理はこの判定を使わない
export const checkAccountWritable = (
  user: UserAccountSnapshot,
  options: AccountWritableOptions,
): AccountDenial | undefined => {
  if (isWithdrawn(user)) {
    return 'withdrawn';
  }
  if (user.status === 'suspended') {
    return 'suspended';
  }
  if (options.requireVerifiedEmail && user.emailVerifiedAt === null) {
    return 'email-not-verified';
  }
  return undefined;
};
