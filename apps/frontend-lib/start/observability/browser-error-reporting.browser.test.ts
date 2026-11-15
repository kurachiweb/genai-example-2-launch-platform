import { expect, test } from 'vitest';

import {
  browserErrorQueue,
  reportUnexpectedErrorInBrowser,
} from './browser-error-reporting.ts';

// TanStack Startのコンパイルを通らないブラウザテストで差し替えずに読み込めることが、画面の部品から使える前提である
test('差し替えずにブラウザで読み込め、報告した想定外の失敗を初期化した送信の関数へ渡す', () => {
  const queued = new Error('初期化の前の描画の失敗');
  reportUnexpectedErrorInBrowser(queued, 'render');
  const sent: unknown[] = [];

  browserErrorQueue.flush((error) => sent.push(error));
  const direct = new Error('初期化の後の描画の失敗');
  reportUnexpectedErrorInBrowser(direct, 'render');

  expect(sent).toStrictEqual([queued, direct]);
});
