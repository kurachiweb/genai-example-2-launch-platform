import { GraphQLClientError } from '../graphql/graphql-result.ts';

export interface TurnstileTokenSource {
  consume(): string | undefined;
  waitForToken(): Promise<string | undefined>;
}

const BOT_VERIFICATION_FAILED_CODE = 'bot_verification_failed';

const isBotVerificationFailure = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === BOT_VERIFICATION_FAILED_CODE;

// 非表示のウィジェットは最初のトークンを画面を開いた後と取り出した後に取り直すため、その間の送信はトークン無しでbot判定に失敗する。その時だけ次のトークンを待って1回だけ送り直す
export async function sendWithTurnstile<TResult>(
  turnstile: TurnstileTokenSource,
  send: (token: string | undefined) => Promise<TResult>,
): Promise<TResult> {
  try {
    return await send(turnstile.consume());
  } catch (error) {
    if (!isBotVerificationFailure(error)) {
      throw error;
    }
    const token = await turnstile.waitForToken();
    if (token === undefined) {
      throw error;
    }
    return send(token);
  }
}
