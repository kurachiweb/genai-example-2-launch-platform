import { editorViewOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';

const hasFiles = (transfer: DataTransfer | null): transfer is DataTransfer =>
  transfer !== null && transfer.files.length > 0;

const hasText = (transfer: DataTransfer): boolean =>
  transfer.getData('text/plain') !== '' || transfer.getData('text/html') !== '';

// 処理済みとして返すとProseMirrorがブラウザの既定の動作(画像の挿入やファイルを開く遷移)を止める。
// 文字列を伴う貼り付け(表計算ソフトなどからのコピー)は文字列だけを取り込ませ、画像は文字列化の処理に任せる。
// ドロップの位置を示す機能のプラグインが自身でドロップを挿入するため、プラグインより先に呼ばれる編集領域の指定に置く
export const configureFileTransferGuard = (ctx: Ctx): void => {
  ctx.update(editorViewOptionsCtx, (options) => ({
    ...options,
    handlePaste: (view, event, slice) =>
      (hasFiles(event.clipboardData) && !hasText(event.clipboardData)) ||
      (options.handlePaste?.(view, event, slice) ?? false),
    handleDrop: (view, event, slice, moved) =>
      hasFiles(event.dataTransfer) ||
      (options.handleDrop?.(view, event, slice, moved) ?? false),
  }));
};
