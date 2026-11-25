import type { LaunchPlanView } from '../../graphql/my-products.ts';

export type RelaunchReservation =
  | { readonly kind: 'checking' }
  // 照会の失敗・本人のプロダクトが見つからない・判定の失敗で、予約できるかを確かめられない
  | { readonly kind: 'unconfirmed' }
  | { readonly kind: 'blocked'; readonly blocks: LaunchPlanView['blocks'] }
  // 予選の敗北後の間隔の制限中だけ、選べる最も早い日(業務日付)を持つ
  | {
      readonly kind: 'available';
      readonly earliestLaunchDate: string | null;
    };

// planのundefinedは照会の結果が届いていない、nullは照会の失敗か本人のプロダクトが見つからない。画面の表示のための判定で、予約の可否は保存の時点に判定し直される
export const relaunchReservationOf = (
  plan: LaunchPlanView | null | undefined,
): RelaunchReservation => {
  if (plan === undefined) {
    return { kind: 'checking' };
  }
  if (plan === null) {
    return { kind: 'unconfirmed' };
  }
  switch (plan.mode) {
    case 'unknown':
      return { kind: 'unconfirmed' };
    case 'blocked':
      return { kind: 'blocked', blocks: plan.blocks };
    case 'new':
    case 'reschedule':
      return {
        kind: 'available',
        earliestLaunchDate:
          plan.window === null || plan.window.relaunchIntervalDays === null
            ? null
            : plan.window.earliest,
      };
  }
};

// 毎秒の更新などを申告している操作のidの集合。状態が変わらなければ同じ集合を返し、描き直しを起こさない
export const withActionReport = (
  reports: ReadonlySet<string>,
  actionId: string,
  active: boolean,
): ReadonlySet<string> => {
  if (reports.has(actionId) === active) {
    return reports;
  }
  return active
    ? new Set([...reports, actionId])
    : new Set([...reports].filter((id) => id !== actionId));
};
