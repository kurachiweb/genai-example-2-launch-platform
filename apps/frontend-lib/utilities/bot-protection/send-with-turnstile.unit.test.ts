import { describe, expect, mock, test } from 'bun:test';

import { GraphQLClientError } from '../graphql/graphql-result.ts';
import {
  sendWithTurnstile,
  type TurnstileTokenSource,
} from './send-with-turnstile.ts';

const botVerificationFailed = (): GraphQLClientError =>
  new GraphQLClientError({
    code: 'bot_verification_failed',
    message: '認証に失敗しました。',
    status: 200,
  });

const forbidden = (): GraphQLClientError =>
  new GraphQLClientError({
    code: 'csrf_rejected',
    message: '操作を受け付けられませんでした。',
    status: 403,
  });

interface FakeSource extends TurnstileTokenSource {
  readonly consume: ReturnType<typeof mock<() => string | undefined>>;
  readonly waitForToken: ReturnType<
    typeof mock<() => Promise<string | undefined>>
  >;
}

const sourceOf = (
  held: string | undefined,
  next: string | undefined,
): FakeSource => ({
  consume: mock(() => held),
  waitForToken: mock(() => Promise.resolve(next)),
});

describe('sendWithTurnstile', () => {
  test('取り出したトークンで送り、成功すれば待たずに結果を返す', async () => {
    const source = sourceOf('turnstile-token-1', 'turnstile-token-2');
    const send = mock((token: string | undefined) =>
      Promise.resolve(`sent:${String(token)}`),
    );

    const result = await sendWithTurnstile(source, send);

    expect(result).toBe('sent:turnstile-token-1');
    expect(send.mock.calls).toEqual([['turnstile-token-1']]);
    expect(source.waitForToken).not.toHaveBeenCalled();
  });

  test('bot判定の失敗なら次のトークンを待ち、そのトークンで1回だけ送り直す', async () => {
    const source = sourceOf(undefined, 'turnstile-token-1');
    const send = mock((token: string | undefined) =>
      token === undefined
        ? Promise.reject(botVerificationFailed())
        : Promise.resolve(`sent:${token}`),
    );

    const result = await sendWithTurnstile(source, send);

    expect(result).toBe('sent:turnstile-token-1');
    expect(send.mock.calls).toEqual([[undefined], ['turnstile-token-1']]);
  });

  test('送り直しもbot判定の失敗なら、それ以上送らずにその失敗を投げる', async () => {
    const source = sourceOf('turnstile-token-1', 'turnstile-token-2');
    const retried = botVerificationFailed();
    const send = mock((token: string | undefined) =>
      Promise.reject(
        token === 'turnstile-token-2' ? retried : botVerificationFailed(),
      ),
    );

    const rejection = sendWithTurnstile(source, send);

    expect(rejection).rejects.toBe(retried);
    await rejection.catch(() => undefined);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('次のトークンが届かなければ、送り直さずに元の失敗を投げる', async () => {
    const source = sourceOf(undefined, undefined);
    const original = botVerificationFailed();
    const send = mock(() => Promise.reject(original));

    const rejection = sendWithTurnstile(source, send);

    expect(rejection).rejects.toBe(original);
    await rejection.catch(() => undefined);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['bot判定以外の403', forbidden()],
    ['GraphQL以外の例外', new Error('通信の失敗')],
  ])('%sは待たずに送り直さず、そのまま投げる', async (_label, error) => {
    const source = sourceOf(undefined, 'turnstile-token-1');
    const send = mock(() => Promise.reject(error));

    const rejection = sendWithTurnstile(source, send);

    expect(rejection).rejects.toBe(error);
    await rejection.catch(() => undefined);
    expect(send).toHaveBeenCalledTimes(1);
    expect(source.waitForToken).not.toHaveBeenCalled();
  });
});
