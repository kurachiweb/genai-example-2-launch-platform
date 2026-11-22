import {
  createEntryNameAllocator,
  toPortableFileName,
} from './archive-names.ts';
import type {
  ExportFileView,
  ExportProduct,
  ExportSnapshot,
} from './export-snapshot.ts';

export interface PlannedBinary {
  readonly fileId: string;
  readonly path: string;
}

export interface PlannedMarkdown {
  readonly path: string;
  readonly text: string;
}

export interface ArchivePlan {
  readonly binaries: readonly PlannedBinary[];
  readonly pathByFileId: ReadonlyMap<string, string>;
  readonly productDirectories: ReadonlyMap<string, string>;
  readonly markdown: readonly PlannedMarkdown[];
}

export const PROFILE_BIO_PATH = 'profile/bio.md';

const PRODUCTS_DIRECTORY = 'products';
const PATH_SEPARATORS = /[/\\]/g;

export function productDescriptionPathOf(productDirectory: string): string {
  return `${productDirectory}/description.md`;
}

export function commentBodyPathOf(commentId: string): string {
  return `comments/${commentId}.md`;
}

// 元のファイル名はアップロード時に区切りを除かれている前提だが、崩れてもディレクトリの外へ出ないよう区切りも置換する
function toEntryName(originalFileName: string): string {
  return toPortableFileName(originalFileName.replace(PATH_SEPARATORS, '-'));
}

function createBinaryPlanner(files: ReadonlyMap<string, ExportFileView>) {
  const allocator = createEntryNameAllocator();
  const binaries: PlannedBinary[] = [];
  const pathByFileId = new Map<string, string>();

  return {
    binaries,
    pathByFileId,
    place(fileId: string, directory: string, originalFileName?: string): void {
      const view = files.get(fileId);
      if (view === undefined || view.quarantined || pathByFileId.has(fileId)) {
        return;
      }
      const name = allocator.allocate(
        directory,
        toEntryName(originalFileName ?? view.originalFileName),
      );
      const path = `${directory}/${name}`;
      pathByFileId.set(fileId, path);
      binaries.push({ fileId, path });
    },
  };
}

interface DirectoryAssignment {
  readonly product: ExportProduct;
  readonly directory: string;
}

function assignProductDirectories(
  products: readonly ExportProduct[],
): readonly DirectoryAssignment[] {
  const allocator = createEntryNameAllocator();
  return products.map((product) => ({
    product,
    directory: `${PRODUCTS_DIRECTORY}/${allocator.allocate(PRODUCTS_DIRECTORY, product.handle)}`,
  }));
}

function planMarkdown(
  snapshot: ExportSnapshot,
  assignments: readonly DirectoryAssignment[],
): readonly PlannedMarkdown[] {
  const bio = snapshot.profile.bioMarkdown;
  return [
    ...(bio === null || bio === ''
      ? []
      : [{ path: PROFILE_BIO_PATH, text: bio }]),
    ...assignments.map(({ product, directory }) => ({
      path: productDescriptionPathOf(directory),
      text: product.descriptionMarkdown,
    })),
    ...snapshot.comments.map((comment) => ({
      path: commentBodyPathOf(comment.id),
      text: comment.bodyMarkdown,
    })),
  ];
}

export function planArchive(snapshot: ExportSnapshot): ArchivePlan {
  const assignments = assignProductDirectories(snapshot.products);
  const planner = createBinaryPlanner(snapshot.files);

  if (snapshot.profile.avatarFileId !== null) {
    planner.place(snapshot.profile.avatarFileId, 'profile/avatar');
  }
  for (const { product, directory } of assignments) {
    planner.place(product.logoFileId, `${directory}/logo`);
    for (const screenshotFileId of product.screenshotFileIds) {
      planner.place(screenshotFileId, `${directory}/screenshots`);
    }
  }
  for (const inquiry of snapshot.inquiries) {
    for (const message of inquiry.messages) {
      for (const attachment of message.attachments) {
        planner.place(
          attachment.fileId,
          `inquiries/${inquiry.id}/${message.id}`,
          attachment.originalFileName,
        );
      }
    }
  }

  return {
    binaries: planner.binaries,
    pathByFileId: planner.pathByFileId,
    productDirectories: new Map(
      assignments.map(({ product, directory }) => [product.id, directory]),
    ),
    markdown: planMarkdown(snapshot, assignments),
  };
}
