import type {
  LaunchDateWindowView,
  LaunchPlanView,
} from '../../graphql/my-products.ts';

// ローンチ日の欄が読み書きするフォームの値。RegisterProductInput・UpdateProductInputと同じくfieldsの外に置き、業務日付(YYYY-MM-DD)で持つ。nullは未選択(編集では予約しない)
export interface LaunchDateFieldValues {
  launchDate: string | null;
}

export type LaunchPlanWithWindow = LaunchPlanView & {
  readonly window: LaunchDateWindowView;
};

// 編集画面でカレンダーを描くのは予定のローンチ日を変えられる時と次回のローンチを予約できる時で、固定の期間と固定を判定できない時はサーバーがローンチ日の変更を拒否するため描かない。描かない間のフォームはローンチ日を含まないスキーマを使う
export const showsLaunchDateCalendar = (
  plan: LaunchPlanView,
): plan is LaunchPlanWithWindow =>
  (plan.mode === 'reschedule' || plan.mode === 'new') &&
  plan.window !== null &&
  !plan.locked &&
  !plan.lockUnknown;
