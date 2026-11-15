import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminUltrasPromotionSettingDocument,
  type AdminUltrasPromotionSettingQuery,
} from './generated/graphql.ts';

export type AdminUltrasPromotionSetting =
  AdminUltrasPromotionSettingQuery['ultrasPromotionSetting'];

export interface PromotionLastChange {
  // nullは最後の変更が無いものとして表示する
  readonly updatedAt: string | null;
  readonly updatedByNickname: string | null;
}

export const adminUltrasPromotionSettingQueryOptions = () =>
  graphqlQueryOptions(AdminUltrasPromotionSettingDocument, {});

// 初期行は保存値の初期化日時を持つため、一度も変更していない(版が0の)設定の日時は最後の変更として扱わない。削除済みの管理者による変更は日時を残し、管理者だけが無い
export const toPromotionLastChange = ({
  version,
  updatedAt,
  updatedByNickname,
}: AdminUltrasPromotionSetting): PromotionLastChange => ({
  updatedAt: version === 0 ? null : updatedAt,
  updatedByNickname,
});
