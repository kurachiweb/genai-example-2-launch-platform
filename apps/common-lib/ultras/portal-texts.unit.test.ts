import { describe, expect, test } from 'bun:test';

import { ULTRAS_PORTAL_UNAVAILABLE_REASON } from './portal-texts.ts';

describe('ULTRAS_PORTAL_UNAVAILABLE_REASON', () => {
  test('文言規則のCustomer Portalの縮退運転の理由の文にする', () => {
    expect(ULTRAS_PORTAL_UNAVAILABLE_REASON).toBe(
      '決済サービスで障害が発生しているため、支払い方法の更新・解約・解約の取り消しを現在ご利用いただけません。しばらく待ってから再度お試しください。閲覧やその他の操作は引き続きご利用いただけます。',
    );
  });

  test('共通部品が描く題名「現在ご利用いただけません。」で始めず、理由の文だけにする', () => {
    expect(
      ULTRAS_PORTAL_UNAVAILABLE_REASON.startsWith('現在ご利用いただけません。'),
    ).toBe(false);
  });
});
