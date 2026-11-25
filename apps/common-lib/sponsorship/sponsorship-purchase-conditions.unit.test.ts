import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_PURCHASE_CONDITIONS } from './sponsorship-purchase-conditions.ts';

describe('SPONSORSHIP_PURCHASE_CONDITIONS', () => {
  test('文言規則の最終確認画面の購入の条件の3つの文を順に持つ', () => {
    expect(SPONSORSHIP_PURCHASE_CONDITIONS).toStrictEqual([
      '掲載期間はUTC-08:00の日付で区切り、開始日の0:00から終了日の翌日の0:00まで掲載します。',
      'プロダクトの公開停止やアカウントの停止で表示を止めても掲載期間は延長されませんが、表示を止めた日数分(1日のうち一部でも止めた日を含みます)と、運営者が掲載を強制終了した場合の未掲載の日数分は、掲載期間が終わった時点(強制終了ではその時点)に日割りで自動で返金します。',
      'プロダクトの削除や退会で掲載が終わった場合は、表示を止めた日数分を含めて返金されません。',
    ]);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(SPONSORSHIP_PURCHASE_CONDITIONS)).toBe(true);
  });
});
