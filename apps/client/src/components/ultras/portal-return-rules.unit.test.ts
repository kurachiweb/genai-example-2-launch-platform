import { describe, expect, test } from 'bun:test';

import {
  PORTAL_RETURN_RECHECK_INTERVAL_MS,
  PORTAL_RETURN_RECHECK_LIMIT,
  portalRecheckIntervalOf,
  portalRechecksRemain,
  updateCountOf,
} from './portal-return-rules.ts';

describe('確かめ直しの間隔と上限', () => {
  test('5秒ごとに最大12回確かめ直す', () => {
    expect(PORTAL_RETURN_RECHECK_INTERVAL_MS).toBe(5000);
    expect(PORTAL_RETURN_RECHECK_LIMIT).toBe(12);
  });
});

describe('updateCountOf', () => {
  test('成功と失敗の更新の回数を足し、失敗した取り直しも1回に数える', () => {
    expect(updateCountOf({ dataUpdateCount: 3, errorUpdateCount: 2 })).toBe(5);
  });

  test('取得の記録が無ければ0回にする', () => {
    expect(updateCountOf(undefined)).toBe(0);
  });
});

describe('portalRechecksRemain', () => {
  test('基準からの取り直しが上限に満たない間は残りがある', () => {
    expect(portalRechecksRemain(1, 1)).toBe(true);
    expect(portalRechecksRemain(12, 1)).toBe(true);
  });

  test('基準からの取り直しが上限に達したら残りが無い', () => {
    expect(portalRechecksRemain(13, 1)).toBe(false);
    expect(portalRechecksRemain(20, 1)).toBe(false);
  });
});

describe('portalRecheckIntervalOf', () => {
  test('残りがある間は確かめ直しの間隔を返す', () => {
    expect(portalRecheckIntervalOf(12, 1)).toBe(
      PORTAL_RETURN_RECHECK_INTERVAL_MS,
    );
  });

  test('上限に達したらfalseを返して定期の取り直しを止める', () => {
    expect(portalRecheckIntervalOf(13, 1)).toBe(false);
  });
});
