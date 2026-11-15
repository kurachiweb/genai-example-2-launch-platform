import type { UltrasActivationHandlerRegistration } from '../../lib/core/ultras/activation-contract.ts';

// 加入が有効になった知らせを受け取る機能(tournament-week・tournament-year)が登録をここへ追記する。
// orderは100以上を各機能のspecが使い、本specは登録を持たない
export const ULTRAS_ACTIVATION_HANDLERS: readonly UltrasActivationHandlerRegistration[] =
  Object.freeze([]);
