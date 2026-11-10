import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { ProductLifecycleSyncRegistration } from '../infrastructure/product/product-lifecycle-sync-handler.ts';

// プロダクトの削除・非公開化・復元と同じ一括の書き込みで自分のデータを変える機能が、登録をここへ追記する
export const PRODUCT_LIFECYCLE_SYNC_HANDLERS: readonly ProductLifecycleSyncRegistration[] =
  [
    {
      name: 'match-engine.product-match-closure',
      events: ['hidden', 'deleted'],
      handler: MATCH_TYPES.ProductMatchClosureSyncHandler,
    },
  ];
