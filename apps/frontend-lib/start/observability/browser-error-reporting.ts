import {
  type BrowserErrorQueue,
  createBrowserErrorQueue,
  type ReportSource,
} from './error-queue.ts';

// ブラウザで1つだけ持ち、Sentryを読み込むまでの失敗を積む。initBrowserObservabilityへ同じ列を渡す
export const browserErrorQueue: BrowserErrorQueue = createBrowserErrorQueue();

// 同型の関数のブラウザの実装と同じ引数で呼べるよう送信元を受け取る。送信元はサーバーのerrorログの属性にだけ使い、ブラウザのエラートラッキングのイベントには載せない
export const reportUnexpectedErrorInBrowser: (
  error: unknown,
  source: ReportSource,
) => void = (error) => {
  browserErrorQueue.enqueue(error);
};
