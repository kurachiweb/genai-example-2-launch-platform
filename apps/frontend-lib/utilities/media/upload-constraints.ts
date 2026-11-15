import {
  type MediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';

export interface UploadConstraints {
  readonly purpose: string;
  readonly allowedTypes: readonly MediaType[];
  readonly maxBytes: number;
  // 文言の主語(例: ロゴ・スクリーンショット・ファイル)
  readonly subjectLabel: string;
  readonly maxCount?: number;
  readonly maxTotalBytes?: number;
  readonly existingCount?: number;
  readonly existingTotalBytes?: number;
}

export interface SelectedFileInfo {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export type SelectionViolation =
  | { readonly kind: 'type'; readonly fileName: string }
  | { readonly kind: 'size'; readonly fileName: string }
  | { readonly kind: 'count' }
  | { readonly kind: 'total' };

export interface SelectionCheckOptions {
  // 編集ダイアログで作り直す形式。作り直した後のサイズで判定するため、選択の時点ではサイズと合計を判定しない
  readonly editedTypes?: readonly MediaType[];
}

type FileCheck =
  | { readonly kind: 'rejected'; readonly violation: SelectionViolation }
  | { readonly kind: 'accepted'; readonly countedBytes: number };

const checkFile = (
  file: SelectedFileInfo,
  constraints: UploadConstraints,
  editedTypes: readonly MediaType[],
): FileCheck => {
  const type = parseMediaType(file.type);
  if (type === undefined || !constraints.allowedTypes.includes(type)) {
    return {
      kind: 'rejected',
      violation: { kind: 'type', fileName: file.name },
    };
  }
  if (editedTypes.includes(type)) {
    return { kind: 'accepted', countedBytes: 0 };
  }
  if (file.size > constraints.maxBytes) {
    return {
      kind: 'rejected',
      violation: { kind: 'size', fileName: file.name },
    };
  }
  return { kind: 'accepted', countedBytes: file.size };
};

const exceeds = (value: number, limit: number | undefined): boolean =>
  limit !== undefined && value > limit;

export const checkSelection = (
  files: readonly SelectedFileInfo[],
  constraints: UploadConstraints,
  options: SelectionCheckOptions = {},
): readonly SelectionViolation[] => {
  const checks = files.map((file) =>
    checkFile(file, constraints, options.editedTypes ?? []),
  );
  const fileViolations = checks.flatMap((check) =>
    check.kind === 'rejected' ? [check.violation] : [],
  );
  const totalBytes = checks.reduce(
    (sum, check) =>
      check.kind === 'accepted' ? sum + check.countedBytes : sum,
    constraints.existingTotalBytes ?? 0,
  );
  const count = (constraints.existingCount ?? 0) + files.length;
  return [
    ...fileViolations,
    ...(exceeds(count, constraints.maxCount)
      ? [{ kind: 'count' } as const]
      : []),
    ...(exceeds(totalBytes, constraints.maxTotalBytes)
      ? [{ kind: 'total' } as const]
      : []),
  ];
};

// SVG以外の画像は、編集ダイアログで切り取って作り直してから送る
export const EDITED_IMAGE_TYPES: readonly MediaType[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// 1件だけの入力欄は選び直すと前のファイルを置き換えるため、既存の個数を数えずに1件を上限にする
export const selectionConstraintsOf = (
  constraints: UploadConstraints,
  multiple: boolean,
): UploadConstraints =>
  multiple ? constraints : { ...constraints, maxCount: 1, existingCount: 0 };
