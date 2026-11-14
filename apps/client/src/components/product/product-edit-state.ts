import type { LaunchPlanView } from '../../graphql/my-products.ts';
import type { ProductLaunchView } from '../../graphql/product-launch.ts';
import { pairingAtOf } from './business-time.ts';
import { LOCK_UNKNOWN_REASON } from './product-edit-messages.ts';

// 編集画面は、予定のローンチの前日の23:45に固定(カテゴリと削除の無効)へ、キックオフの0:00に予選マッチ中へ表示を切り替えるため、その時刻に取り直す。選べる日の23:40はローンチ日の欄が取り直す
export const editRefreshBoundariesOf = (
  latestLaunch: ProductLaunchView | null,
): readonly string[] => {
  switch (latestLaunch?.status) {
    case 'scheduled':
      return [pairingAtOf(latestLaunch.launchDate), latestLaunch.kickoffAt];
    case 'paired':
      return [latestLaunch.kickoffAt];
    default:
      return [];
  }
};

// ローンチ日・カテゴリの変更と削除を受け付けない理由。固定の期間でなく固定を判定できたならundefined
export const changeLockReasonOf = (
  plan: LaunchPlanView,
): string | undefined => {
  const reasons = [
    ...plan.locks.map(({ message }) => message),
    ...(plan.lockUnknown ? [LOCK_UNKNOWN_REASON] : []),
  ];
  return reasons.length === 0 ? undefined : reasons.join('');
};
