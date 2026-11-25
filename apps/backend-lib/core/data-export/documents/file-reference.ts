import type { ArchivePlan } from '../export-plan.ts';
import type { ExportSnapshot } from '../export-snapshot.ts';

export interface DocumentInput {
  readonly snapshot: ExportSnapshot;
  readonly plan: ArchivePlan;
  readonly stored: ReadonlySet<string>;
}

export interface FileReference {
  readonly path: string | null;
  readonly quarantined: boolean | null;
  readonly originalFileName: string | null;
  readonly contentType: string | null;
  readonly size: number | null;
}

const NO_FILE: FileReference = {
  path: null,
  quarantined: null,
  originalFileName: null,
  contentType: null,
  size: null,
};

// 格納できたファイルのうち、計画にパスがあるものだけをパスとして返す
export function storedPathOf(
  input: DocumentInput,
  fileId: string,
): string | null {
  return input.stored.has(fileId)
    ? (input.plan.pathByFileId.get(fileId) ?? null)
    : null;
}

// 記録が無いファイルは隔離の印も判らないため、メタデータごとnullにする
export function referenceFile(
  input: DocumentInput,
  fileId: string | null,
): FileReference {
  const view = fileId === null ? undefined : input.snapshot.files.get(fileId);
  if (fileId === null || view === undefined) {
    return NO_FILE;
  }
  return {
    path: storedPathOf(input, fileId),
    quarantined: view.quarantined,
    originalFileName: view.originalFileName,
    contentType: view.contentType,
    size: view.byteSize,
  };
}
