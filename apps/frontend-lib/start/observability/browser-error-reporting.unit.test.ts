import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  browserErrorQueue,
  reportUnexpectedErrorInBrowser,
} from './browser-error-reporting.ts';
import { MAX_QUEUED_ERRORS } from './error-queue.ts';

const graphQLError = (code: string): GraphQLClientError =>
  new GraphQLClientError({ code, message: '失敗しました', status: 500 });

// 送信待ちの列はモジュールに1つだけのため、初期化の前と後を1つのテストの中で順に確かめる
describe('reportUnexpectedErrorInBrowser', () => {
  test('初期化の前は送る失敗だけを上限まで積み、初期化で積んだ分を送った後は直接送る', () => {
    const beforeInit = Array.from(
      { length: MAX_QUEUED_ERRORS + 1 },
      (_, index) => new Error(`初期化の前の失敗${String(index)}`),
    );
    const [first] = beforeInit;
    reportUnexpectedErrorInBrowser(graphQLError('not_found'), 'graphql');
    reportUnexpectedErrorInBrowser(graphQLError('upstream_timeout'), 'loader');
    for (const error of beforeInit) {
      reportUnexpectedErrorInBrowser(error, 'render');
    }
    reportUnexpectedErrorInBrowser(first, 'loader');
    const sent: unknown[] = [];

    browserErrorQueue.flush((error) => sent.push(error));

    expect(sent).toStrictEqual(beforeInit.slice(0, MAX_QUEUED_ERRORS));

    const afterInit = new Error('初期化の後の失敗');
    reportUnexpectedErrorInBrowser(afterInit, 'render');
    reportUnexpectedErrorInBrowser(afterInit, 'graphql');
    reportUnexpectedErrorInBrowser(graphQLError('csrf_rejected'), 'graphql');

    expect(sent.slice(MAX_QUEUED_ERRORS)).toStrictEqual([afterInit]);
  });
});
