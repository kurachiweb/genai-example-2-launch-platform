import type { ProductLifecycleAsyncRegistration } from '../../lib/core/product/product-lifecycle.ts';

// プロダクトの非公開化・復元・論理削除・物理削除の時期の到来の後にイベントサーバーで自分のデータを変える機能が、登録をここへ追記する。
// orderは機能ごとに割り当てた帯を使い、物理削除の時期の到来では全ての処理の後に実行器がプロダクトの行を物理削除する
export const PRODUCT_LIFECYCLE_ASYNC_HANDLERS: readonly ProductLifecycleAsyncRegistration[] =
  Object.freeze([]);
