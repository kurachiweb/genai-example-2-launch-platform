// 編集領域のチャンクの読み込みの失敗。通信や配信の失敗で利用者が再試行して回復するため、想定外の失敗としてエラートラッキングへ送らない
export class EditorLoadError extends Error {
  constructor(cause: unknown) {
    super('編集領域のモジュールを読み込めませんでした。', { cause });
    this.name = 'EditorLoadError';
  }
}
