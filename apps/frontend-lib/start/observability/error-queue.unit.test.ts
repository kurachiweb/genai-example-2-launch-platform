import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  createBrowserErrorQueue,
  createFirstReportFilter,
  isReportableFailure,
  MAX_QUEUED_ERRORS,
} from './error-queue.ts';

const graphQLError = (code: string): GraphQLClientError =>
  new GraphQLClientError({ code, message: '失敗しました', status: 500 });

const recordingSender = (): {
  readonly sent: unknown[];
  readonly send: (error: unknown) => void;
} => {
  const sent: unknown[] = [];
  return { sent, send: (error) => sent.push(error) };
};

describe('isReportableFailure', () => {
  test.each(['internal_error', 'network_error', 'invalid_response'])(
    '想定外のコード%sを持つGraphQLClientErrorは送る',
    (code) => {
      expect(isReportableFailure(graphQLError(code))).toBe(true);
    },
  );

  test.each(['not_found', 'csrf_rejected', 'rate_limit_exceeded'])(
    '想定内のコード%sを持つGraphQLClientErrorは送らない',
    (code) => {
      expect(isReportableFailure(graphQLError(code))).toBe(false);
    },
  );

  test.each(['upstream_unavailable', 'upstream_timeout'])(
    '中継が上流に届かなかった時に元の例外を送っているため、%sは送らない',
    (code) => {
      expect(isReportableFailure(graphQLError(code))).toBe(false);
    },
  );

  test.each([
    ['Error', new Error('描画に失敗しました')],
    ['文字列', 'unexpected'],
    ['undefined', undefined],
  ])('GraphQLClientErrorでない値(%s)は送る', (_label, error) => {
    expect(isReportableFailure(error)).toBe(true);
  });
});

describe('createFirstReportFilter', () => {
  test('同じ例外のオブジェクトは最初の1回だけ通す', () => {
    const isFirstReport = createFirstReportFilter();
    const error = new Error('描画に失敗しました');

    expect(isFirstReport(error)).toBe(true);
    expect(isFirstReport(error)).toBe(false);
    expect(isFirstReport(new Error('描画に失敗しました'))).toBe(true);
  });

  test('同一性を判定できない値は毎回通す', () => {
    const isFirstReport = createFirstReportFilter();

    expect(isFirstReport('unexpected')).toBe(true);
    expect(isFirstReport('unexpected')).toBe(true);
    expect(isFirstReport(undefined)).toBe(true);
  });
});

describe('createBrowserErrorQueue', () => {
  test('初期化の前の送信を積み、flushで積んだ順に送る', () => {
    const queue = createBrowserErrorQueue();
    const first = new Error('1件目');
    const second = new Error('2件目');
    const sender = recordingSender();

    queue.enqueue(first);
    queue.enqueue(second);
    expect(sender.sent).toEqual([]);
    queue.flush(sender.send);

    expect(sender.sent).toEqual([first, second]);
  });

  test('既定の上限は10件で、上限を超えた送信は捨てる', () => {
    const queue = createBrowserErrorQueue();
    const errors = Array.from(
      { length: 12 },
      (_, index) => new Error(`${String(index + 1)}件目`),
    );
    const sender = recordingSender();

    for (const error of errors) {
      queue.enqueue(error);
    }
    queue.flush(sender.send);

    expect(MAX_QUEUED_ERRORS).toBe(10);
    expect(sender.sent).toEqual(errors.slice(0, 10));
  });

  test('上限を指定できる', () => {
    const queue = createBrowserErrorQueue(2);
    const errors = [new Error('1件目'), new Error('2件目'), new Error('3件目')];
    const sender = recordingSender();

    for (const error of errors) {
      queue.enqueue(error);
    }
    queue.flush(sender.send);

    expect(sender.sent).toEqual(errors.slice(0, 2));
  });

  test('上限で捨てた例外は初期化の後に再び届けば送る', () => {
    const queue = createBrowserErrorQueue(1);
    const kept = new Error('1件目');
    const dropped = new Error('2件目');
    const sender = recordingSender();

    queue.enqueue(kept);
    queue.enqueue(dropped);
    queue.flush(sender.send);
    queue.enqueue(dropped);

    expect(sender.sent).toEqual([kept, dropped]);
  });

  test('同じ例外の2回目は積まず、初期化の後も送らない', () => {
    const queue = createBrowserErrorQueue();
    const error = new Error('描画に失敗しました');
    const sender = recordingSender();

    queue.enqueue(error);
    queue.enqueue(error);
    queue.flush(sender.send);
    queue.enqueue(error);

    expect(sender.sent).toEqual([error]);
  });

  test('想定内の失敗と中継が送った失敗は積まない', () => {
    const queue = createBrowserErrorQueue();
    const unexpected = graphQLError('network_error');
    const sender = recordingSender();

    queue.enqueue(graphQLError('not_found'));
    queue.enqueue(graphQLError('upstream_timeout'));
    queue.enqueue(unexpected);
    queue.flush(sender.send);

    expect(sender.sent).toEqual([unexpected]);
  });

  test('初期化の後は積まずに直接送る', () => {
    const queue = createBrowserErrorQueue(1);
    const errors = [new Error('1件目'), new Error('2件目'), new Error('3件目')];
    const sender = recordingSender();

    queue.flush(sender.send);
    for (const error of errors) {
      queue.enqueue(error);
    }

    expect(sender.sent).toEqual(errors);
  });

  test('初期化の後の想定内の失敗と同じ例外の2回目は送らない', () => {
    const queue = createBrowserErrorQueue();
    const error = new Error('描画に失敗しました');
    const sender = recordingSender();

    queue.flush(sender.send);
    queue.enqueue(graphQLError('csrf_rejected'));
    queue.enqueue(error);
    queue.enqueue(error);

    expect(sender.sent).toEqual([error]);
  });

  test('2回目のflushは送り先を差し替えず、積んだものを送り直さない', () => {
    const queue = createBrowserErrorQueue();
    const queued = new Error('初期化の前');
    const later = new Error('初期化の後');
    const first = recordingSender();
    const second = recordingSender();

    queue.enqueue(queued);
    queue.flush(first.send);
    queue.flush(second.send);
    queue.enqueue(later);

    expect(first.sent).toEqual([queued, later]);
    expect(second.sent).toEqual([]);
  });

  test('送信の例外は呼び出し元へ伝えず、残りの送信を続ける', () => {
    const queue = createBrowserErrorQueue();
    const errors = [new Error('1件目'), new Error('2件目')];
    const later = new Error('初期化の後');
    const attempted: unknown[] = [];
    const failingSend = (error: unknown): void => {
      attempted.push(error);
      throw new Error('送信に失敗しました');
    };

    for (const error of errors) {
      queue.enqueue(error);
    }
    expect(() => {
      queue.flush(failingSend);
    }).not.toThrow();
    expect(() => {
      queue.enqueue(later);
    }).not.toThrow();

    expect(attempted).toEqual([...errors, later]);
  });
});
