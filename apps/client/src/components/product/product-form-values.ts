import type { UpdateProductInput } from '../../graphql/generated/graphql.ts';
import type { MyProductEditView } from '../../graphql/my-products.ts';
import type {
  EditProductFormOutput,
  ProductFormInput,
} from './product-form-schema.ts';

// サーバーの詳細は既定値に経路がある欄にだけ対応するため、全欄を空の値で持つ
export const EMPTY_PRODUCT_FORM_VALUES: ProductFormInput = Object.freeze({
  fields: Object.freeze({
    name: '',
    tagline: '',
    categoryId: '',
    handle: '',
    websiteUrl: '',
    description: '',
    logoFileId: null,
    screenshotFileIds: [],
  }),
  launchDate: null,
});

// 予定のローンチ日を変更できる時は現在の日を選択済みにし、次回のローンチの予約は選ばなければ予約しない
export const editProductFormDefaultsOf = (
  product: MyProductEditView,
): ProductFormInput => ({
  fields: {
    name: product.name,
    tagline: product.tagline,
    categoryId: product.category.id,
    handle: product.handle,
    websiteUrl: product.websiteUrl,
    description: product.description,
    logoFileId: product.logoFileId,
    screenshotFileIds: product.screenshots.map(({ fileId }) => fileId),
  },
  launchDate:
    product.plan.mode === 'reschedule' ? product.plan.currentLaunchDate : null,
});

// 無効にしたカテゴリの欄は送る値から外れるため、読み込んだカテゴリを送り、カテゴリを変えない。ローンチ日の欄を描かない間はnull(ローンチを変えない)を送る
export const toUpdateProductInput = (
  { fields, launchDate }: EditProductFormOutput,
  product: MyProductEditView,
): UpdateProductInput => ({
  productHandle: product.handle,
  expectedVersion: product.version,
  fields: { ...fields, categoryId: fields.categoryId ?? product.category.id },
  launchDate: launchDate ?? null,
});
