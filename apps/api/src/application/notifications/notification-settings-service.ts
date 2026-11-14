import { inject, injectable } from 'inversify';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type {
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type { NotificationPreferenceStore } from '../../../lib/core/notifications/ports.ts';
import { notificationsError } from './notifications-errors.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import type { DeliveryStatus, DeliveryStatusReader } from './ports.ts';

export interface NotificationSettingsView {
  readonly preferences: ReadonlyMap<NotificationTopic, boolean>;
  readonly delivery: DeliveryStatus;
  readonly emailVerified: boolean;
  // 停止中・退会済みはfalse
  readonly editable: boolean;
}

// ログインと退会済みでないことは呼び出し元のリゾルバがAccountGuardで確かめる
export interface NotificationSettingsService {
  read(user: CurrentUser): Promise<NotificationSettingsView>;
  // 停止中・退会済みはAppError(account_unavailable)
  update(
    user: CurrentUser,
    topic: NotificationTopic,
    enabled: boolean,
    now: Date,
  ): Promise<NotificationSettingsView>;
}

const isEditable = (user: UserAccountView): boolean =>
  user.status === 'active' && user.deletedAt === null;

// 除外が解ける日時は期限付きの受信側の拒否にだけ示す
const toDisplayedDelivery = (status: DeliveryStatus): DeliveryStatus =>
  status.kind === 'suppressed' && status.reason !== 'rejected'
    ? { kind: 'suppressed', reason: status.reason, until: null }
    : status;

@injectable()
export class StoreNotificationSettingsService implements NotificationSettingsService {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
    @inject(NOTIFICATIONS_TYPES.DeliveryStatusReader)
    private readonly delivery: DeliveryStatusReader,
  ) {}

  async read(user: CurrentUser): Promise<NotificationSettingsView> {
    const [preferences, delivery] = await Promise.all([
      this.preferences.preferencesOf(user.user.id),
      this.deliveryOf(user.user.id),
    ]);
    return {
      preferences,
      delivery,
      emailVerified: user.user.emailVerifiedAt !== null,
      editable: isEditable(user.user),
    };
  }

  async update(
    user: CurrentUser,
    topic: NotificationTopic,
    enabled: boolean,
    now: Date,
  ): Promise<NotificationSettingsView> {
    // 受信設定のストアは利用者の状態を見ないため、停止中の変更をここで拒否する
    if (!isEditable(user.user)) {
      throw notificationsError('account_unavailable');
    }
    await this.preferences.setPreference({
      userId: user.user.id,
      topic,
      enabled,
      at: now,
    });
    return this.read(user);
  }

  // 配信の状態を確認できなくても受信可否の表示と変更を妨げない
  private async deliveryOf(userId: string): Promise<DeliveryStatus> {
    try {
      return toDisplayedDelivery(await this.delivery.statusOf(userId));
    } catch {
      return { kind: 'unknown' };
    }
  }
}
