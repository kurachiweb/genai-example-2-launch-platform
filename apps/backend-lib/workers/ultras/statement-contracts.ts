import type { BatchItem } from 'drizzle-orm/batch';

import type {
  SubscriptionRow,
  UltrasNoticeKind,
} from '../../core/ultras/ports.ts';

// 文を返す契約はworkers/ultrasの口の実装と各アプリのinfrastructure層だけが受け取る。application層はDBの一括の書き込みを扱わないため、core/ultras/ports.tsの文を返さない操作と分ける

export interface SubscriptionStatements {
  // Stripe側の状態の列だけを更新する(onConflictDoUpdate)
  upsertStripeState(input: {
    readonly row: SubscriptionRow;
  }): BatchItem<'sqlite'>;
  // 無ければ挿入(状態active)、あればstarted_at・user_id・purchase_idだけ更新する
  activate(input: {
    readonly id: string;
    readonly stripeSubscriptionId: string;
    readonly userId: string;
    readonly purchaseId: string;
    readonly startedAt: Date;
  }): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}

export interface ActivationStatements {
  // 定期課金のIDで一意
  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly activatedAt: Date;
  }): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}

export interface NoticeStatements {
  // 重複排除の鍵で一意
  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly kind: UltrasNoticeKind;
    readonly dedupeKey: string;
    readonly payload: Readonly<Record<string, string>>;
  }): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}
