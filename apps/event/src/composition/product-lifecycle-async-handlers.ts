import type { ProductLifecycleAsyncRegistration } from '../../lib/core/product/product-lifecycle.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';

// プロダクトの非公開化・復元・論理削除・物理削除の時期の到来の後にイベントサーバーで自分のデータを変える機能が、登録をここへ追記する。
// orderは機能ごとに割り当てた帯を使い、物理削除の時期の到来では全ての処理の後に実行器がプロダクトの行を物理削除する
export const PRODUCT_LIFECYCLE_ASYNC_HANDLERS: readonly ProductLifecycleAsyncRegistration[] =
  Object.freeze([
    {
      name: 'product-launch.image-quarantine',
      events: ['hidden', 'unhidden'],
      order: 1000,
      handler: EVENT_PRODUCT_TYPES.ProductImageQuarantineHandler,
    },
    {
      name: 'product-launch.image-erasure',
      events: ['purge_due'],
      order: 1000,
      handler: EVENT_PRODUCT_TYPES.ProductImageErasureHandler,
    },
    {
      name: 'match-engine.product-decision-follow-up',
      events: ['hidden', 'deleted'],
      order: 1100,
      handler: EVENT_MATCH_TYPES.ProductDecisionFollowUpHandler,
    },
    {
      name: 'match-engine.entry-unlink',
      events: ['purge_due'],
      order: 1100,
      handler: EVENT_MATCH_TYPES.EntryUnlinkHandler,
    },
  ]);
