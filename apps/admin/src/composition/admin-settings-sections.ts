import type { ComponentType } from 'react';

import { SENDER_INFO_TITLE } from '../components/notifications/sender-info-messages.ts';
import { SenderInfoSection } from '../components/notifications/sender-info-section.tsx';
import { PROMOTION_SETTING_TITLE } from '../components/ultras/promotion-setting-messages.ts';
import { PromotionSettingSection } from '../components/ultras/promotion-setting-section.tsx';
import { FINAL_DATE_SECTION_TITLE } from '../components/year-tournament/final-date-labels.ts';
import { FinalDateSection } from '../components/year-tournament/final-date-section.tsx';

export interface AdminSettingsSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // tournament-yearのYearトーナメントの決勝実施日10・ultras-subscriptionのUltras導線の機能フラグ20・notificationsの通知メールの送信者情報30
  readonly order: number;
  // 区画の見出し。部品が描く見出しと同じ文言にする
  readonly title: string;
  // 自分でデータを取得し、自分の見出しを描く
  readonly component: ComponentType;
}

// 設定のページに並べる区画の登録箇所。各specが自分の設定の区画を追記する
export const ADMIN_SETTINGS_SECTIONS: readonly AdminSettingsSection[] =
  Object.freeze([
    {
      id: 'tournament-year.final-date',
      order: 10,
      title: FINAL_DATE_SECTION_TITLE,
      component: FinalDateSection,
    },
    {
      id: 'ultras-subscription.promotion-flag',
      order: 20,
      title: PROMOTION_SETTING_TITLE,
      component: PromotionSettingSection,
    },
    {
      id: 'notifications.sender-info',
      order: 30,
      title: SENDER_INFO_TITLE,
      component: SenderInfoSection,
    },
  ]);
