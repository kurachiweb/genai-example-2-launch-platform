import { describe, expect, test } from 'bun:test';

import {
  NONCE,
  recordingApi,
  renderContextOf,
  runInStartRequest,
  htmlResponse,
} from '../test/start-request-fixtures.ts';
import {
  readFrontendRequestContext,
  readServerInitialRuntime,
  readServerRequestNonce,
} from './request-context.server.ts';

const unusedApi = recordingApi(() =>
  Promise.reject(new Error('APIは呼ばない')),
);

const readInRequest = async <T>(
  context: unknown,
  read: () => T,
): Promise<{ readonly value?: T; readonly error?: unknown }> => {
  let outcome: { readonly value?: T; readonly error?: unknown } = {};
  await runInStartRequest({
    context,
    render: () => {
      try {
        outcome = { value: read() };
      } catch (error) {
        outcome = { error };
      }
      return Promise.resolve(htmlResponse());
    },
  });
  return outcome;
};

describe('request-context.server', () => {
  test('描画の文脈からnonceを読む', async () => {
    const context = renderContextOf({ api: unusedApi });

    expect(await readInRequest(context, readServerRequestNonce)).toEqual({
      value: NONCE,
    });
    expect(
      (await readInRequest(context, readFrontendRequestContext)).value,
    ).toBe(context);
  });

  test('初期の実行時の値は公開設定と表示設定だけで、中継の文脈やAPIを含まない', async () => {
    const context = renderContextOf({ api: unusedApi });

    const { value } = await readInRequest(context, readServerInitialRuntime);

    expect(value).toEqual({
      publicConfig: context.publicConfig,
      display: context.display,
    });
  });

  test.each([
    ['オブジェクトでない', 'context'],
    ['nonceを持たない', { api: unusedApi }],
    ['nonceが文字列でない', { nonce: 42 }],
  ])(
    '文脈が%s場合は、エントリを経由していないことを示す例外にする',
    async (_, context) => {
      const { error } = await readInRequest(context, readServerRequestNonce);

      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('createFrontendServerEntry');
    },
  );
});
