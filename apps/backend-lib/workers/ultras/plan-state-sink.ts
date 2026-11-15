import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';
import type { BatchItem } from 'drizzle-orm/batch';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  StripeSubscriptionStatus,
  SubscriptionChange,
} from '../../core/payments/purchase-kind-contract.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
  UltrasNotifier,
} from '../../core/ultras/ports.ts';
import {
  applySubscriptionChange,
  EMPTY_SUBSCRIPTION_SNAPSHOT,
  type SubscriptionChangeInput,
  type SubscriptionTransitionAnomaly,
  type SubscriptionTransitionNotice,
} from '../../core/ultras/subscription-transition.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { SubscriptionEventSink } from '../payments/fulfillment-contract.ts';
import type {
  NoticeStatements,
  SubscriptionStatements,
} from './statement-contracts.ts';
import { noticePayloadOf } from './ultras-notifier.ts';

export const ULTRAS_PLAN_STATE_SINK_NAME = 'ultras-subscription.plan-state';

export interface PlanStateSinkDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly subscriptions: SubscriptionStore;
  readonly subscriptionStatements: SubscriptionStatements;
  readonly noticeStatements: NoticeStatements;
  readonly notifier: UltrasNotifier;
  readonly ids: IdGenerator;
}

interface AnomalyReport {
  readonly incident: string;
  readonly message: string;
}

const ANOMALY_REPORTS: Readonly<
  Record<SubscriptionTransitionAnomaly['kind'], AnomalyReport>
> = {
  unexpected_status: {
    incident: 'unexpected-subscription-status',
    message: '本サービスの設定では届かないはずの定期課金の状態を受け取りました',
  },
  scheduled_end_missing: {
    incident: 'scheduled-end-missing',
    message:
      '解約が予約された定期課金に終了の予定時刻が無く、特典の終了時刻を決められませんでした',
  },
};

const STRIPE_SUBSCRIPTION_ID_PATTERN = /^sub_[0-9A-Za-z_]{1,255}$/u;

// 型の状態を漏れなく列挙し、状態が増えたら型検査で気付く
const KNOWN_STRIPE_STATUSES: Readonly<Record<StripeSubscriptionStatus, true>> =
  {
    incomplete: true,
    incomplete_expired: true,
    trialing: true,
    active: true,
    past_due: true,
    canceled: true,
    unpaid: true,
    paused: true,
  };

const UNSAFE_VALUE = 'unknown';

// タグは除去処理の対象外のため、識別子と既知の状態の形の値だけを送る
const safeSubscriptionId = (value: string): string =>
  STRIPE_SUBSCRIPTION_ID_PATTERN.test(value) ? value : UNSAFE_VALUE;

const safeStatus = (value: string): string =>
  Object.hasOwn(KNOWN_STRIPE_STATUSES, value) ? value : UNSAFE_VALUE;

// 再試行の後は解約する設定と一時停止を使わない設定のため、unpaid・pausedの受信と終了の予定時刻の無い予約はStripe側の設定の誤りを示す。加入状態は保存したうえで、運営者が気付けるよう知らせる
function reportAnomaly(
  logger: Logger,
  change: SubscriptionChange,
  anomaly: SubscriptionTransitionAnomaly,
): void {
  const { incident, message } = ANOMALY_REPORTS[anomaly.kind];
  const stripeSubscriptionId = safeSubscriptionId(change.subscriptionId);
  const tags = {
    ultras_incident: incident,
    stripe_subscription_id: stripeSubscriptionId,
    ...(anomaly.kind === 'unexpected_status'
      ? { stripe_status: safeStatus(anomaly.status) }
      : {}),
  };
  logger.warn(message, {
    stripeSubscriptionId,
    kind: anomaly.kind,
    status: change.status,
  });
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: 'warning',
    logentry: { message },
    fingerprint: ['ultras', incident],
    tags,
  });
}

function transitionInputOf(
  change: SubscriptionChange,
): SubscriptionChangeInput {
  return {
    status: change.status,
    cancelAtPeriodEnd: change.cancelAtPeriodEnd,
    cancelAt: change.cancelAt,
    currentPeriodEnd: change.currentPeriodEnd,
    endedAt: change.endedAt,
    occurredAt: change.occurredAt,
  };
}

export class PlanStateSink implements SubscriptionEventSink {
  private readonly subscriptions: SubscriptionStore;
  private readonly subscriptionStatements: SubscriptionStatements;
  private readonly noticeStatements: NoticeStatements;
  private readonly notifier: UltrasNotifier;
  private readonly ids: IdGenerator;
  private readonly logger: Logger;

  constructor(dependencies: PlanStateSinkDependencies) {
    this.subscriptions = dependencies.subscriptions;
    this.subscriptionStatements = dependencies.subscriptionStatements;
    this.noticeStatements = dependencies.noticeStatements;
    this.notifier = dependencies.notifier;
    this.ids = dependencies.ids;
    this.logger = getAppLogger([dependencies.appName, 'application', 'ultras']);
  }

  // 照会と文の組み立てだけを行い、書き込みは返した文をpaymentsが定期課金の前進と一括で確定する。古い通知はpaymentsが捨てるため、届いた変化を最新として扱い、発生時刻を比べない
  async statementsFor(
    change: SubscriptionChange,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    const { userId } = change;
    if (userId === null) {
      return [];
    }
    const previous =
      (await this.subscriptions.findByStripeId(change.subscriptionId)) ??
      this.unactivatedRowOf(change, userId);
    const result = applySubscriptionChange(
      previous,
      transitionInputOf(change),
      change.subscriptionId,
    );
    for (const anomaly of result.anomalies) {
      reportAnomaly(this.logger, change, anomaly);
    }
    return [
      this.subscriptionStatements.upsertStripeState({
        row: { ...previous, ...result.next },
      }),
      ...result.notices.map((notice) =>
        this.noticeStatementOf(previous, notice),
      ),
    ];
  }

  // 有効化の前に届いた変化もStripe側の値として保存し、有効化の時に使う。IDは行がまだ無いときだけ使われる
  private unactivatedRowOf(
    change: SubscriptionChange,
    userId: string,
  ): SubscriptionRow {
    return {
      ...EMPTY_SUBSCRIPTION_SNAPSHOT,
      id: this.ids.generate(),
      stripeSubscriptionId: change.subscriptionId,
      userId,
      purchaseId: change.purchaseId,
    };
  }

  private noticeStatementOf(
    row: SubscriptionRow,
    notice: SubscriptionTransitionNotice,
  ): BatchItem<'sqlite'> {
    return this.noticeStatements.insertIfAbsent({
      id: this.ids.generate(),
      userId: row.userId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      kind: notice.kind,
      dedupeKey: notice.dedupeKey,
      payload: noticePayloadOf(notice),
    });
  }

  // 一括の書き込みを確定させた側だけが呼ぶ。1件ごとの送信の失敗は送信側がwarnに留め、日次の確認が依頼し直す
  async afterCommit(change: SubscriptionChange): Promise<void> {
    await this.notifier.sendPendingFor(change.subscriptionId);
  }
}
