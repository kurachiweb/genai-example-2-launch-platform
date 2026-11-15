import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import { INQUIRY_TYPES } from '../application/inquiry/inquiry-types.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import type { UserLifecycleSyncRegistration } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';

// 利用者の退会・停止・停止解除と同じ一括の書き込みで自分のデータを変える機能が、登録をここへ追記する
export const USER_LIFECYCLE_SYNC_HANDLERS: readonly UserLifecycleSyncRegistration[] =
  [
    {
      name: 'inquiry-chat.member-inquiry-withdrawal',
      events: ['withdrawn'],
      handler: INQUIRY_TYPES.MemberInquiryWithdrawalHandler,
    },
    {
      name: 'user-profile-social.withdrawal',
      events: ['withdrawn'],
      handler: PROFILE_TYPES.ProfileWithdrawalSyncHandler,
    },
    {
      name: 'product-launch.withdrawal',
      events: ['withdrawn'],
      handler: PRODUCT_TYPES.ProductWithdrawalSyncHandler,
    },
    {
      name: 'product-launch.launch-cancellation',
      events: ['suspended'],
      handler: PRODUCT_TYPES.LaunchCancellationSyncHandler,
    },
    {
      name: 'match-engine.account-match-closure',
      events: ['withdrawn', 'suspended'],
      handler: MATCH_TYPES.AccountMatchClosureSyncHandler,
    },
    {
      name: 'directory-discovery.account-index-removal',
      events: ['withdrawn', 'suspended'],
      handler: DIRECTORY_TYPES.AccountIndexRemovalSyncHandler,
    },
  ];
