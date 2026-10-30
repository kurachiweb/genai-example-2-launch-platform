import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { $remark } from '@milkdown/kit/utils';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/bidi';

// 強調・太字の書き戻しはMilkdownの文字列化の設定が独自の処理で上書きし、隣接する文字を文字参照にしないため、解析だけを拡張する。
// 取り消し線はMilkdownが書き戻しを上書きせず、句読点の後の文字が文字参照(&#x...;)になるため、書き戻しも拡張する入口を使う
export const cjkRemarkPlugins: readonly MilkdownPlugin[] = [
  ...$remark('remarkCjkFriendly', () => remarkCjkFriendly),
  ...$remark(
    'remarkCjkFriendlyGfmStrikethrough',
    () => remarkCjkFriendlyGfmStrikethrough,
  ),
];
