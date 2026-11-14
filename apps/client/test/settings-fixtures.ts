import { page } from 'vitest/browser';

import {
  GraphQLClientError,
  type GraphQLClientErrorInit,
} from '../lib/utilities/graphql/graphql-result.ts';

export const CURRENT_PASSWORD = ['pitch', 'notes', 'launch'].join('-');

export const NEW_PASSWORD = ['stadium', 'kick', 'off'].join('-');

export const CURRENT_PASSWORD_INCORRECT =
  '現在のパスワードが正しくありません。';

export const SECOND_FACTOR_INCORRECT = '認証コードが正しくありません。';

export const graphqlFailure = (init: GraphQLClientErrorInit) =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

// APIサーバーの本人確認の失敗と同じく、詳細の経路をmutationの入力の形のとおりに返す
export const reauthenticationFailed = (
  field: string,
  code: 'incorrect' | 'required',
  message: string,
) =>
  graphqlFailure({
    code: 'reauthentication_failed',
    message,
    status: 422,
    details: [{ field, code, message }],
  });

// ダイアログが開いている間は外側の要素が支援技術とポインターから隠れるため、偽物のウィジェットの操作のボタンは要素のclickで押す。最後に描いたウィジェットの判定を成功させる
export function passBotCheck(): void {
  const buttons = page
    .getByText('判定を成功させる', { exact: true })
    .elements();
  const last = buttons.at(-1);
  if (!(last instanceof HTMLButtonElement)) {
    throw new Error('bot判定の偽物のウィジェットが描画されていません。');
  }
  last.click();
}
