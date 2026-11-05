import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { PaymentRecordRow } from '../../../lib/core/payments/ports.ts';
import {
  createAccountGuard,
  createPaymentRecordStore,
  paymentRecordRowOf,
  PSEUDONYMOUS_ID,
  type RecordListCall,
  SESSION,
  UNAUTHENTICATED,
} from '../../../test/support/payments-checkout-fakes.ts';
import {
  decodePaymentHistoryCursor,
  encodePaymentHistoryCursor,
} from './payment-history-cursor.ts';
import {
  type PaymentHistoryReader,
  StorePaymentHistoryReader,
} from './payment-history-reader.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

interface Options {
  readonly rows?: readonly PaymentRecordRow[];
  readonly guardError?: Error;
}

function rowsOf(count: number): PaymentRecordRow[] {
  return Array.from({ length: count }, (_unused, index) =>
    paymentRecordRowOf(index + 1),
  );
}

function rowAt(
  rows: readonly PaymentRecordRow[],
  index: number,
): PaymentRecordRow {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`${String(index)}番目の記録がありません`);
  }
  return row;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const listCalls: RecordListCall[] = [];
  const container = new Container();
  const bindConstant = <T>(identifier: ServiceIdentifier<T>, value: T) => {
    container.bind<T>(identifier).toConstantValue(value);
  };
  bindConstant(
    IDENTITY_PLATFORM_TYPES.AccountGuard,
    createAccountGuard(calls, options.guardError),
  );
  bindConstant(
    PAYMENTS_TYPES.PaymentRecordStore,
    createPaymentRecordStore(calls, listCalls, options.rows ?? rowsOf(3)),
  );
  container
    .bind<PaymentHistoryReader>(API_PAYMENTS_TYPES.PaymentHistoryReader)
    .to(StorePaymentHistoryReader);
  return {
    reader: container.get<PaymentHistoryReader>(
      API_PAYMENTS_TYPES.PaymentHistoryReader,
    ),
    calls,
    listCalls,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否されませんでした');
}

describe('StorePaymentHistoryReader', () => {
  test('本人の仮名化IDの記録を、表示する項目と各記録の位置のカーソル付きで新しい順に返す', async () => {
    const refund = paymentRecordRowOf(2, {
      kind: 'refund',
      amount: -1500,
      quantity: null,
    });
    const { reader, calls, listCalls } = setup({
      rows: [paymentRecordRowOf(1), refund],
    });

    const page = await reader.list(SESSION, {});

    expect(listCalls).toEqual([
      { pseudonymousId: PSEUDONYMOUS_ID, first: 21, after: null },
    ]);
    expect(page.edges.map(({ node }) => node)).toEqual([
      {
        id: paymentRecordRowOf(1).id,
        kind: 'one_time',
        purpose: 'week_tournament_entry',
        amount: { amount: 1500, currency: 'usd' },
        quantity: 3,
        status: 'succeeded',
        occurredAt: paymentRecordRowOf(1).occurredAt,
      },
      {
        id: refund.id,
        kind: 'refund',
        purpose: 'week_tournament_entry',
        amount: { amount: -1500, currency: 'usd' },
        quantity: null,
        status: 'succeeded',
        occurredAt: refund.occurredAt,
      },
    ]);
    expect(
      page.edges.map(({ cursor }) => decodePaymentHistoryCursor(cursor)),
    ).toEqual([
      {
        occurredAt: paymentRecordRowOf(1).occurredAt,
        id: paymentRecordRowOf(1).id,
      },
      { occurredAt: refund.occurredAt, id: refund.id },
    ]);
    expect(page.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: page.edges.at(-1)?.cursor ?? null,
    });
    expect(calls).toEqual(['requireUser', 'listByPseudonymousId']);
  });

  test('Stripe側のIDと関連する対象のIDを一覧の項目に含めない', async () => {
    const { reader } = setup();

    const page = await reader.list(SESSION, {});

    for (const { node } of page.edges) {
      expect(Object.keys(node).toSorted()).toEqual([
        'amount',
        'id',
        'kind',
        'occurredAt',
        'purpose',
        'quantity',
        'status',
      ]);
    }
  });

  test('件数を省略すると20件を返し、続きがあれば最後の記録の位置を返す', async () => {
    const rows = rowsOf(25);
    const { reader } = setup({ rows });

    const page = await reader.list(SESSION, {});

    expect(page.edges.map(({ node }) => node.id)).toEqual(
      rows.slice(0, 20).map(({ id }) => id),
    );
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(decodePaymentHistoryCursor(page.pageInfo.endCursor ?? '')).toEqual({
      occurredAt: rowAt(rows, 19).occurredAt,
      id: rowAt(rows, 19).id,
    });
  });

  test('前のページの最後のカーソルから、続きの記録を返す', async () => {
    const rows = rowsOf(25);
    const { reader, listCalls } = setup({ rows });
    const first = await reader.list(SESSION, {});

    const next = await reader.list(SESSION, {
      after: first.pageInfo.endCursor ?? undefined,
    });

    expect(listCalls[1]?.after).toEqual({
      occurredAt: rowAt(rows, 19).occurredAt,
      id: rowAt(rows, 19).id,
    });
    expect(next.edges.map(({ node }) => node.id)).toEqual(
      rows.slice(20).map(({ id }) => id),
    );
    expect(next.pageInfo.hasNextPage).toBe(false);
  });

  test.each([1, 50])('件数%dを指定どおりに返す', async (first) => {
    const { reader, listCalls } = setup({ rows: rowsOf(60) });

    const page = await reader.list(SESSION, { first });

    expect(page.edges).toHaveLength(first);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(listCalls[0]?.first).toBe(first + 1);
  });

  test('件数ちょうどの記録しか無ければ続きが無い', async () => {
    const { reader } = setup({ rows: rowsOf(20) });

    const page = await reader.list(SESSION, { first: 20 });

    expect(page.edges).toHaveLength(20);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  test('記録が無ければ空の一覧と空の位置を返す', async () => {
    const { reader } = setup({ rows: [] });

    expect(await reader.list(SESSION, {})).toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test.each([0, 51, -1, 1.5])(
    '件数%dを、記録を読まずに件数の欄の入力の検証のエラーにする',
    async (first) => {
      const { reader, calls } = setup();

      const error = await rejectionOf(reader.list(SESSION, { first }));

      expect(error).toBeInstanceOf(AppError);
      expect({
        kind: (error as AppError).kind,
        code: (error as AppError).code,
        details: (error as AppError).details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [
          {
            field: 'first',
            code: 'out-of-range',
            message: '表示する件数は1〜50件の整数で指定してください。',
          },
        ],
      });
      expect(calls).toEqual(['requireUser']);
    },
  );

  test('形式の誤ったカーソルを、記録を読まずにページの位置の指定の誤りにする', async () => {
    const { reader, calls } = setup();

    const error = await rejectionOf(reader.list(SESSION, { after: '!!!!' }));

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: (error as AppError).kind,
      code: (error as AppError).code,
    }).toEqual({ kind: 'bad_request', code: 'invalid_cursor' });
    expect(calls).toEqual(['requireUser']);
  });

  test('カーソルは本人の仮名化IDの一覧の中の位置としてだけ使う', async () => {
    const { reader, listCalls } = setup();
    const cursor = encodePaymentHistoryCursor({
      occurredAt: new Date('2030-01-01T00:00:00.000Z'),
      id: '01JD0000000000000000ZZZZZZ',
    });

    await reader.list(SESSION, { after: cursor });

    expect(listCalls[0]?.pseudonymousId).toBe(PSEUDONYMOUS_ID);
  });

  test('ログインしていなければ記録を読まずに拒否する', async () => {
    const { reader, calls } = setup({ guardError: UNAUTHENTICATED });

    expect(await rejectionOf(reader.list(SESSION, {}))).toBe(UNAUTHENTICATED);
    expect(calls).toEqual(['requireUser']);
  });
});
