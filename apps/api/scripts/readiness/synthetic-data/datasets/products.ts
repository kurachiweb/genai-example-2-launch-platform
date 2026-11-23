import { productCategories } from '../../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../../db/schema/product/product-launches.ts';
import { products } from '../../../../db/schema/product/products.ts';
import {
  CATEGORY_COUNT,
  LARGEST_CREATOR_INDEX,
  categoryAt,
  launchOf,
  productAt,
  type EntityContext,
} from '../entities.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

const SAMPLE_COUNT = 5;

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
  ...(context.logoFileId === undefined
    ? {}
    : { logoFileId: context.logoFileId }),
});

function* categoryRows(entities: EntityContext): Generator<SqlRow> {
  for (let index = 0; index < CATEGORY_COUNT; index += 1) {
    const category = categoryAt(entities, index);
    yield {
      id: category.id,
      name: category.name,
      handle: category.handle,
      systemDefault: false,
      createdAt: category.createdAt,
      updatedAt: category.createdAt,
    };
  }
}

function* productRows(entities: EntityContext): Generator<SqlRow> {
  for (let index = 0; index < entities.profile.products; index += 1) {
    const product = productAt(entities, index);
    yield {
      id: product.id,
      userId: product.ownerId,
      categoryId: product.categoryId,
      handle: product.handle,
      name: product.name,
      tagline: product.tagline,
      websiteUrl: product.websiteUrl,
      descriptionMarkdown: product.descriptionMarkdown,
      logoFileId: product.logoFileId,
      latestLaunchDate: product.latestLaunchDate,
      createdAt: product.createdAt,
      updatedAt: product.createdAt,
    };
  }
}

// 全てのプロダクトに未確定のローンチを1件ずつ作る。確定した過去のローンチ(予選の勝利)とマッチは予選のデータセットが足す
function* launchRows(entities: EntityContext): Generator<SqlRow> {
  for (let index = 0; index < entities.profile.products; index += 1) {
    const launch = launchOf(entities, index);
    yield {
      id: launch.id,
      productId: launch.productId,
      launchDate: launch.launchDate,
      createdAt: launch.createdAt,
      updatedAt: launch.createdAt,
    };
  }
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  yield* insertStatements(productCategories, categoryRows(entities));
  yield* insertStatements(products, productRows(entities));
  yield* insertStatements(productLaunches, launchRows(entities));
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  const entities = entityContextOf(profile, context);
  return {
    largestCreatorProductHandle: [
      productAt(entities, LARGEST_CREATOR_INDEX).handle,
    ],
    productHandles: Array.from(
      { length: Math.min(SAMPLE_COUNT, profile.products) },
      (_, index) => productAt(entities, index).handle,
    ),
  };
}

export const productsDataset: SyntheticDataset = {
  name: 'products',
  dependsOn: ['users'],
  generate,
  samples,
};
