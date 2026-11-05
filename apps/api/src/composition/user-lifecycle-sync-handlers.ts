import { INQUIRY_TYPES } from '../application/inquiry/inquiry-types.ts';
import type { UserLifecycleSyncRegistration } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';

// 利用者の退会・停止・停止解除と同じ一括の書き込みで自分のデータを変える機能が、登録をここへ追記する
export const USER_LIFECYCLE_SYNC_HANDLERS: readonly UserLifecycleSyncRegistration[] =
  [
    {
      name: 'inquiry-chat.member-inquiry-withdrawal',
      events: ['withdrawn'],
      handler: INQUIRY_TYPES.MemberInquiryWithdrawalHandler,
    },
  ];
