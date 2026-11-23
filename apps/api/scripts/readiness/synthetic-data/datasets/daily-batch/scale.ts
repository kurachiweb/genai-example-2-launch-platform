import { YEAR_ONE_PROFILE, type ScaleProfile } from '../../scale-profile.ts';

// 想定規模の件数を、利用者の数の比で規模に合わせて縮める。検証用の規模でも最低1件は残す
export function scaledCount(
  profile: ScaleProfile,
  yearOneCount: number,
): number {
  return Math.max(
    1,
    Math.ceil((yearOneCount * profile.users) / YEAR_ONE_PROFILE.users),
  );
}

export const DAY_MS = 86_400_000;

export const HOUR_MS = 3_600_000;
