import { productDescriptionPathOf } from '../export-plan.ts';
import type { ExportProduct } from '../export-snapshot.ts';
import { toIsoUtc, toIsoUtcOrNull } from './export-formats.ts';
import { referenceFile } from './file-reference.ts';
import type { DocumentInput, FileReference } from './file-reference.ts';

export interface ProductDocument {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: string;
  readonly websiteUrl: string;
  readonly descriptionPath: string;
  readonly logoPath: string | null;
  readonly logoQuarantined: boolean | null;
  readonly logoOriginalFileName: string | null;
  readonly logoContentType: string | null;
  readonly logoSize: number | null;
  readonly screenshots: readonly FileReference[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly hiddenByAdmin: boolean;
}

export interface LaunchDocument {
  readonly id: string;
  readonly productId: string;
  readonly launchDate: string;
  readonly status: string;
  readonly matches: readonly {
    readonly id: string;
    readonly kind: string;
    readonly round: number | null;
    readonly date: string;
    readonly upvoteCount: number;
    readonly opponentUpvoteCount: number;
    readonly lastUpvotedAt: string | null;
    readonly result: string | null;
  }[];
  readonly awards: readonly {
    readonly kind: string;
    readonly period: string;
  }[];
}

function descriptionPathOf(
  input: DocumentInput,
  product: ExportProduct,
): string {
  const directory = input.plan.productDirectories.get(product.id);
  if (directory === undefined) {
    throw new Error(`プロダクトのディレクトリが計画に無い: ${product.id}`);
  }
  return productDescriptionPathOf(directory);
}

// 項目を明示して写す。上流の取得結果に余分な項目が混ざっても出力へ出さないため
export function buildProductsDocument(
  input: DocumentInput,
): readonly ProductDocument[] {
  return input.snapshot.products.map((product) => {
    const logo = referenceFile(input, product.logoFileId);
    return {
      id: product.id,
      handle: product.handle,
      name: product.name,
      tagline: product.tagline,
      category: product.categoryName,
      websiteUrl: product.websiteUrl,
      descriptionPath: descriptionPathOf(input, product),
      logoPath: logo.path,
      logoQuarantined: logo.quarantined,
      logoOriginalFileName: logo.originalFileName,
      logoContentType: logo.contentType,
      logoSize: logo.size,
      screenshots: product.screenshotFileIds.map((fileId) => {
        const screenshot = referenceFile(input, fileId);
        return {
          path: screenshot.path,
          quarantined: screenshot.quarantined,
          originalFileName: screenshot.originalFileName,
          contentType: screenshot.contentType,
          size: screenshot.size,
        };
      }),
      createdAt: toIsoUtc(product.createdAt),
      updatedAt: toIsoUtc(product.updatedAt),
      deletedAt: toIsoUtcOrNull(product.deletedAt),
      hiddenByAdmin: product.hiddenByAdmin,
    };
  });
}

export function buildLaunchesDocument({
  snapshot,
}: DocumentInput): readonly LaunchDocument[] {
  return snapshot.launches.map((launch) => ({
    id: launch.id,
    productId: launch.productId,
    launchDate: launch.launchDate,
    status: launch.status,
    matches: launch.matches.map((match) => ({
      id: match.id,
      kind: match.kind,
      round: match.round,
      date: match.date,
      upvoteCount: match.upvoteCount,
      opponentUpvoteCount: match.opponentUpvoteCount,
      lastUpvotedAt: toIsoUtcOrNull(match.lastUpvotedAt),
      result: match.result,
    })),
    awards: launch.awards.map((award) => ({
      kind: award.kind,
      period: award.period,
    })),
  }));
}
