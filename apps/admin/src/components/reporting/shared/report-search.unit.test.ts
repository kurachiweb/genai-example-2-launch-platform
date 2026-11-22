import { describe, expect, test } from 'bun:test';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../../../common-lib/reporting/report-rules.ts';
import {
  REPORT_SEARCH_STATUS_OF,
  REPORT_SEARCH_TARGET_OF,
  reportCaseFilterScopeOf,
  reportCaseListArgsOf,
  reportCaseSearchAt,
  toReportSearch,
  withReportSearchFilters,
} from './report-search.ts';

const UNSPECIFIED_SEARCH = Object.freeze({
  status: undefined,
  target: undefined,
  category: undefined,
  from: undefined,
  to: undefined,
  after: undefined,
});

describe('toReportSearch', () => {
  test('対応ステータス・対象の種類・カテゴリ・受付日の開始日と終了日とページの位置を取り出し、知らない項目を落とす', () => {
    expect(
      toReportSearch({
        status: 'OPEN',
        target: 'COMMENT',
        category: REPORT_CATEGORY_INFRINGEMENT_ID,
        from: '2026-11-01',
        to: '2026-11-03',
        after: 'cursor-1',
        q: 'unknown',
      }),
    ).toStrictEqual({
      status: 'OPEN',
      target: 'COMMENT',
      category: REPORT_CATEGORY_INFRINGEMENT_ID,
      from: '2026-11-01',
      to: '2026-11-03',
      after: 'cursor-1',
    });
  });

  test('値の無い検索パラメータでも、ルーターが元の値を残さないよう全ての項目を未指定で返す', () => {
    expect(toReportSearch({})).toStrictEqual(UNSPECIFIED_SEARCH);
  });

  test('不正な値は項目ごとに未指定にし、他の項目は残す', () => {
    expect(
      toReportSearch({
        status: 'open',
        target: 'RATING',
        category: '01je0000000000000000000001',
        from: '2026-02-30',
        to: '2026/11/03',
        after: 'c'.repeat(257),
      }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
    expect(
      toReportSearch({ status: 'IN_PROGRESS', target: 1, category: 12 }),
    ).toStrictEqual({ ...UNSPECIFIED_SEARCH, status: 'IN_PROGRESS' });
  });

  test('空文字の値は未指定にする', () => {
    expect(
      toReportSearch({
        status: '',
        target: '',
        category: '',
        from: '',
        to: '',
        after: '',
      }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
  });

  test('256文字のページの位置は受け付ける', () => {
    expect(toReportSearch({ after: 'c'.repeat(256) }).after).toBe(
      'c'.repeat(256),
    );
  });

  test('開始日が終了日より後の期間は両端とも未指定にし、同じ日と片方だけの期間は残す', () => {
    expect(
      toReportSearch({ status: 'OPEN', from: '2026-11-05', to: '2026-11-04' }),
    ).toStrictEqual({ ...UNSPECIFIED_SEARCH, status: 'OPEN' });
    expect(
      toReportSearch({ from: '2026-11-04', to: '2026-11-04' }),
    ).toStrictEqual({
      ...UNSPECIFIED_SEARCH,
      from: '2026-11-04',
      to: '2026-11-04',
    });
    expect(toReportSearch({ to: '2026-11-04' })).toStrictEqual({
      ...UNSPECIFIED_SEARCH,
      to: '2026-11-04',
    });
  });
});

describe('reportCaseListArgsOf', () => {
  test('URLの列挙の値を上流の値へ写し、受付日の期間を閲覧者の地域の暦で開始日の0時を含み終了日の翌日0時を含まない範囲にする', () => {
    expect(
      reportCaseListArgsOf(
        {
          status: 'IN_PROGRESS',
          target: 'PRODUCT',
          category: REPORT_CATEGORY_OTHER_ID,
          from: '2026-11-01',
          to: '2026-11-03',
          after: 'cursor-1',
        },
        'Asia/Tokyo',
      ),
    ).toStrictEqual({
      status: 'in_progress',
      targetKind: 'product',
      categoryId: REPORT_CATEGORY_OTHER_ID,
      reportedFrom: '2026-10-31T15:00:00.000Z',
      reportedBefore: '2026-11-03T15:00:00.000Z',
      after: 'cursor-1',
    });
  });

  test('値の無い条件は照会の引数に含めない', () => {
    expect(reportCaseListArgsOf(UNSPECIFIED_SEARCH, 'UTC')).toStrictEqual({});
    expect(reportCaseListArgsOf({ to: '2026-11-04' }, 'UTC')).toStrictEqual({
      reportedBefore: '2026-11-05T00:00:00.000Z',
    });
  });

  test('全ての対応ステータスと対象の種類を上流の値へ写す', () => {
    expect(REPORT_SEARCH_STATUS_OF).toStrictEqual({
      OPEN: 'open',
      IN_PROGRESS: 'in_progress',
      RESOLVED: 'resolved',
      REJECTED: 'rejected',
    });
    expect(REPORT_SEARCH_TARGET_OF).toStrictEqual({
      USER: 'user',
      PRODUCT: 'product',
      COMMENT: 'comment',
    });
  });
});

describe('ページの位置と条件', () => {
  const SEARCH = Object.freeze({
    ...UNSPECIFIED_SEARCH,
    status: 'OPEN',
    from: '2026-11-01',
    after: 'cursor-1',
  } as const);

  test('条件を保ったままページの位置だけを替え、値の無い項目を持たない', () => {
    expect(reportCaseSearchAt(SEARCH, 'cursor-2')).toStrictEqual({
      status: 'OPEN',
      from: '2026-11-01',
      after: 'cursor-2',
    });
    expect(reportCaseSearchAt(SEARCH, undefined)).toStrictEqual({
      status: 'OPEN',
      from: '2026-11-01',
    });
  });

  test('ページの位置を除いた条件を、項目の順に依らない1つの値にする', () => {
    expect(reportCaseFilterScopeOf(SEARCH)).toBe(
      reportCaseFilterScopeOf({ from: '2026-11-01', status: 'OPEN' }),
    );
    expect(reportCaseFilterScopeOf({ from: '2026-11-01' })).not.toBe(
      reportCaseFilterScopeOf({ to: '2026-11-01' }),
    );
  });

  test('条件を変えるとページの位置を外し、変えた条件をもう一度正規化して値の無い項目を持たない', () => {
    expect(
      withReportSearchFilters(SEARCH, { target: 'USER', status: undefined }),
    ).toStrictEqual({ target: 'USER', from: '2026-11-01' });
    expect(withReportSearchFilters(SEARCH, { to: '2026-10-01' })).toStrictEqual(
      { status: 'OPEN' },
    );
  });
});
