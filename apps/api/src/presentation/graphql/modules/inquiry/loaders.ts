import { ADMIN_PLATFORM_TYPES } from '../../../../../lib/core/admin/identifiers.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../../../lib/core/admin/ports.ts';
import type { InquiryCategoryService } from '../../../../application/inquiry/inquiry-category-service.ts';
import { INQUIRY_TYPES } from '../../../../application/inquiry/inquiry-types.ts';
import type { InquiryCategoryRecord } from '../../../../application/inquiry/ports.ts';
import { defineLoader } from '../../loaders.ts';

// カテゴリの削除は紐付く問い合わせを標準カテゴリへ付け替えるため、問い合わせのカテゴリが見つからないのはデータの不整合である
export const inquiryCategoryLoader = defineLoader<
  string,
  InquiryCategoryRecord
>({
  name: 'inquiryCategory',
  batch: async (ids, scope) => {
    const categories = await scope
      .resolve<InquiryCategoryService>(INQUIRY_TYPES.InquiryCategoryService)
      .list();
    const byId = new Map(categories.map((category) => [category.id, category]));
    return ids.map(
      (id) =>
        byId.get(id) ?? new Error(`問い合わせのカテゴリ${id}が見つかりません`),
    );
  },
});

// 削除済みの管理者は照会口が返さないため、undefinedを置く
export const inquiryReplyAdminLoader = defineLoader<
  string,
  AdminProfileView | undefined
>({
  name: 'inquiryReplyAdmin',
  batch: async (ids, scope) => {
    const profiles = await scope
      .resolve<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
      .findProfiles(ids);
    return ids.map((id) => profiles.get(id));
  },
});
