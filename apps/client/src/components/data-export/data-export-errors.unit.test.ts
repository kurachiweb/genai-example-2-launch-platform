import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { dataExportRequestErrorOf } from './data-export-errors.ts';

const NOW = new Date('2026-09-15T07:40:00.000Z');

const clientErrorOf = (
  init: Partial<ConstructorParameters<typeof GraphQLClientError>[0]> & {
    readonly code: string;
  },
) =>
  new GraphQLClientError({
    message: 'サーバーの文言です。',
    status: 200,
    ...init,
  });

describe('dataExportRequestErrorOf', () => {
  test('回数の上限は、再試行の秒数を現在の日時へ足した再び要求できる日時にする', () => {
    const error = clientErrorOf({
      code: 'rate_limit_exceeded',
      status: 429,
      retryAfterSeconds: 5400,
    });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'rate_limited',
      retryAt: new Date('2026-09-15T09:10:00.000Z'),
    });
  });

  test('再試行の秒数が0でも、現在の日時を再び要求できる日時にする', () => {
    const error = clientErrorOf({
      code: 'rate_limit_exceeded',
      status: 429,
      retryAfterSeconds: 0,
    });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'rate_limited',
      retryAt: NOW,
    });
  });

  test('回数の上限でも再試行の秒数が無ければ、日時を示さずサーバーの文言を示す', () => {
    const error = clientErrorOf({
      code: 'rate_limit_exceeded',
      status: 429,
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'message',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
  });

  test('メールアドレスの未確認は、データエクスポート専用の文言にする', () => {
    const error = clientErrorOf({ code: 'email_not_verified', status: 200 });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'message',
      message: 'データエクスポートはメールアドレスの確認後に利用できます。',
    });
  });

  test.each([
    ['生成の依頼を送れなかった', 'data_export_unavailable', 503],
    ['通信が失敗した', 'network_error', 0],
    ['中継が上流へ届かなかった', 'upstream_unavailable', 503],
    ['応答を解釈できない', 'invalid_response', 200],
    ['APIサーバーの内部エラー', 'internal_error', 500],
  ])('%sときは、通信の失敗の文言にする', (_name, code, status) => {
    const error = clientErrorOf({ code, status });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'message',
      message:
        '要求を受け付けられませんでした。時間をおいて再度お試しください。',
    });
  });

  test('GraphQLの失敗でない例外は、例外の内容を漏らさず通信の失敗の文言にする', () => {
    expect(
      dataExportRequestErrorOf(new TypeError('Failed to fetch'), NOW),
    ).toEqual({
      kind: 'message',
      message:
        '要求を受け付けられませんでした。時間をおいて再度お試しください。',
    });
  });

  test('上のどれでもない想定内の失敗は、サーバーの文言のまま示す', () => {
    const error = clientErrorOf({
      code: 'account_unavailable',
      status: 200,
      message: 'このアカウントは現在ご利用いただけません。',
    });

    expect(dataExportRequestErrorOf(error, NOW)).toEqual({
      kind: 'message',
      message: 'このアカウントは現在ご利用いただけません。',
    });
  });
});
