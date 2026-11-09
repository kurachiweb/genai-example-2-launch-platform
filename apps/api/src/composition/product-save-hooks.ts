import type { ProductSaveHookRegistration } from '../infrastructure/product/product-save-hooks.ts';

// プロダクトの登録・編集・説明文の更新と同じ一括の書き込みに文を加える、または確定の後に処理を行う機能が、登録をここへ追記する
export const PRODUCT_SAVE_HOOKS: readonly ProductSaveHookRegistration[] = [];
