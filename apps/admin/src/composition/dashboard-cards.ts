import type { ComponentType } from 'react';

import { UnhandledInquiriesCard } from '../components/inquiry/unhandled-inquiries-card.tsx';
import { WeeklyStatisticsCard } from '../components/moderation/statistics/weekly-statistics-card.tsx';
import { UnhandledReportsCard } from '../components/reporting/dashboard/unhandled-reports-card.tsx';

export interface DashboardCard {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // ugc-moderationの統計10・inquiry-chatの未対応の問い合わせ20・content-reportingの未対応の通報30
  readonly order: number;
  readonly width: 'full' | 'half';
  // 自分でデータを取得し、DashboardCardFrameで枠と状態を表示する
  readonly component: ComponentType;
}

// ダッシュボードに並べるカードの登録箇所。各specがカードを追記する
export const DASHBOARD_CARDS: readonly DashboardCard[] = Object.freeze([
  {
    id: 'ugc-moderation.weekly-statistics',
    order: 10,
    width: 'full',
    component: WeeklyStatisticsCard,
  },
  {
    id: 'inquiry-chat.unhandled-inquiries',
    order: 20,
    width: 'half',
    component: UnhandledInquiriesCard,
  },
  {
    id: 'content-reporting.unhandled-reports',
    order: 30,
    width: 'half',
    component: UnhandledReportsCard,
  },
]);
