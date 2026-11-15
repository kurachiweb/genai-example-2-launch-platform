import { describe, expect, test } from 'bun:test';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminUltrasPromotionSettingQueryOptions,
  toPromotionLastChange,
} from './admin-ultras-promotion.ts';
import { AdminUltrasPromotionSettingDocument } from './generated/graphql.ts';

const UPDATED_AT = '2026-11-05T01:02:03.000Z';

describe('adminUltrasPromotionSettingQueryOptions', () => {
  test('操作の識別子と空の変数だけのキーを持つ', () => {
    expect([
      ...adminUltrasPromotionSettingQueryOptions().queryKey,
    ]).toStrictEqual([documentIdOf(AdminUltrasPromotionSettingDocument), {}]);
  });
});

describe('toPromotionLastChange', () => {
  test('変更された設定は、保存された日時と変更した管理者のニックネームをそのまま返す', () => {
    expect(
      toPromotionLastChange({
        enabled: true,
        updatedAt: UPDATED_AT,
        updatedByNickname: '統括の担当',
        version: 3,
      }),
    ).toStrictEqual({ updatedAt: UPDATED_AT, updatedByNickname: '統括の担当' });
  });

  test('一度も変更していない初期の設定は、初期化の日時を最後の変更にせず、日時と管理者を空にする', () => {
    expect(
      toPromotionLastChange({
        enabled: false,
        updatedAt: '2026-11-06T00:00:00.000Z',
        updatedByNickname: null,
        version: 0,
      }),
    ).toStrictEqual({ updatedAt: null, updatedByNickname: null });
  });

  test('削除済みの管理者が変更した設定は、日時を残して管理者だけを空にする', () => {
    expect(
      toPromotionLastChange({
        enabled: false,
        updatedAt: UPDATED_AT,
        updatedByNickname: null,
        version: 2,
      }),
    ).toStrictEqual({ updatedAt: UPDATED_AT, updatedByNickname: null });
  });
});
