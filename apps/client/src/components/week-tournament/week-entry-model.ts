import type { ClientMyWeekEntryQuery } from '../../graphql/generated/graphql.ts';

export type WeekEntryPanelView = NonNullable<
  ClientMyWeekEntryQuery['myWeekEntry']
>;

// 組み合わせ決定の前で受付中か参加資格を得た枠だけが、削除で参加資格を失い参加費の返金の対象になる
export const hasWeekEntryDeleteNotice = (
  entry: WeekEntryPanelView | null,
): boolean =>
  entry !== null &&
  (entry.status === 'AWAITING_PAYMENT' || entry.status === 'ENTITLED');
