export type ScaleProfileName = 'year-one' | 'smoke';

export interface ScaleProfile {
  readonly name: ScaleProfileName;
  readonly users: number;
  readonly products: number;
  readonly qualifierWins: number;
  readonly comments: number;
  readonly repliesInLargestThread: number;
  readonly activeSponsorships: number;
  readonly followersOfLargestCreator: number;
  readonly reportCases: number;
  readonly auditLogs: number;
  readonly exportHeavyUsers: 1;
  readonly orphanFiles: 1200;
  readonly maxLengthHelpArticles: 1;
}

export const YEAR_ONE_PROFILE: ScaleProfile = Object.freeze({
  name: 'year-one',
  users: 50_000,
  products: 20_000,
  qualifierWins: 100_000,
  comments: 200_000,
  repliesInLargestThread: 500,
  activeSponsorships: 1_000,
  followersOfLargestCreator: 10_000,
  reportCases: 5_000,
  auditLogs: 100_000,
  exportHeavyUsers: 1,
  orphanFiles: 1_200,
  maxLengthHelpArticles: 1,
});

const SMOKE_DIVISOR = 1_000;

const scaleDown = (count: number): number =>
  Math.max(1, Math.ceil(count / SMOKE_DIVISOR));

export const SMOKE_PROFILE: ScaleProfile = Object.freeze({
  ...YEAR_ONE_PROFILE,
  name: 'smoke',
  users: scaleDown(YEAR_ONE_PROFILE.users),
  products: scaleDown(YEAR_ONE_PROFILE.products),
  qualifierWins: scaleDown(YEAR_ONE_PROFILE.qualifierWins),
  comments: scaleDown(YEAR_ONE_PROFILE.comments),
  repliesInLargestThread: scaleDown(YEAR_ONE_PROFILE.repliesInLargestThread),
  activeSponsorships: scaleDown(YEAR_ONE_PROFILE.activeSponsorships),
  followersOfLargestCreator: scaleDown(
    YEAR_ONE_PROFILE.followersOfLargestCreator,
  ),
  reportCases: scaleDown(YEAR_ONE_PROFILE.reportCases),
  auditLogs: scaleDown(YEAR_ONE_PROFILE.auditLogs),
});

export const SCALE_PROFILES: Readonly<Record<ScaleProfileName, ScaleProfile>> =
  Object.freeze({ 'year-one': YEAR_ONE_PROFILE, smoke: SMOKE_PROFILE });

export function scaleProfileOf(name: string): ScaleProfile {
  const profile = Object.hasOwn(SCALE_PROFILES, name)
    ? SCALE_PROFILES[name as ScaleProfileName]
    : undefined;
  if (profile === undefined) {
    throw new RangeError(
      `規模の名前は${Object.keys(SCALE_PROFILES).join('・')}から選んでください: ${name}`,
    );
  }
  return profile;
}

const COUNT_KEYS = [
  'users',
  'products',
  'qualifierWins',
  'comments',
  'repliesInLargestThread',
  'activeSponsorships',
  'followersOfLargestCreator',
  'reportCases',
  'auditLogs',
] as const;

// 作り手1人と、そのフォロワーと、1人1プロダクトの投稿者がそれぞれ別の利用者として作れる規模であることを確かめる
export function assertScaleProfile(profile: ScaleProfile): void {
  for (const key of COUNT_KEYS) {
    if (!Number.isSafeInteger(profile[key]) || profile[key] < 1) {
      throw new RangeError(
        `${key}は1以上の整数で指定してください: ${String(profile[key])}`,
      );
    }
  }
  if (profile.followersOfLargestCreator + 1 > profile.users) {
    throw new RangeError(
      `フォロワーの数(${String(profile.followersOfLargestCreator)})に作り手の1人を足した数が利用者の数(${String(profile.users)})を超えています`,
    );
  }
  if (profile.products > profile.users) {
    throw new RangeError(
      `プロダクトの数(${String(profile.products)})が利用者の数(${String(profile.users)})を超えています`,
    );
  }
}
