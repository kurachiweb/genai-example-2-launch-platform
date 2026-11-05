import type { UserLifecycleAsyncRegistration } from '../../lib/core/identity/user-lifecycle.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import { EVENT_INQUIRY_TYPES } from '../application/inquiry/event-inquiry-types.ts';

// 退会・停止・停止解除・物理削除の開始の後にイベントサーバーで自分のデータを変える機能が、登録をここへ追記する。
// orderは0〜9999を各ドメインspecが使い、10000以上はアカウント機能が使う
export const USER_LIFECYCLE_ASYNC_HANDLERS: readonly UserLifecycleAsyncRegistration[] =
  Object.freeze([
    {
      name: 'inquiry-chat.member-inquiry-purge',
      events: ['purge_due'],
      order: 300,
      handler: EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
    },
    {
      name: 'identity-auth.email-suppression-cleanup',
      events: ['withdrawn'],
      order: 10000,
      handler: EVENT_IDENTITY_TYPES.EmailSuppressionCleanupHandler,
    },
  ]);
