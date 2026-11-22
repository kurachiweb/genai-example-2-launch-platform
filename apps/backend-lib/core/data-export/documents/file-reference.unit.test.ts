import { describe, expect, test } from 'bun:test';

import type { ArchivePlan } from '../export-plan.ts';
import type { ExportFileView, ExportSnapshot } from '../export-snapshot.ts';
import { referenceFile } from './file-reference.ts';
import type { DocumentInput } from './file-reference.ts';

function fileView(
  fileId: string,
  overrides: Partial<ExportFileView> = {},
): ExportFileView {
  return {
    fileId,
    originalFileName: 'logo.png',
    contentType: 'image/png',
    byteSize: 61_234,
    quarantined: false,
    ...overrides,
  };
}

function documentInput(
  views: readonly ExportFileView[],
  paths: Readonly<Record<string, string>>,
  stored: readonly string[],
): DocumentInput {
  const plan: ArchivePlan = {
    binaries: [],
    pathByFileId: new Map(Object.entries(paths)),
    productDirectories: new Map(),
    markdown: [],
  };
  return {
    snapshot: {
      files: new Map(views.map((view) => [view.fileId, view])),
    } as unknown as ExportSnapshot,
    plan,
    stored: new Set(stored),
  };
}

const NULL_REFERENCE = {
  path: null,
  quarantined: null,
  originalFileName: null,
  contentType: null,
  size: null,
};

describe('referenceFile', () => {
  test('格納できたファイルはパスとメタデータを返す', () => {
    const input = documentInput([fileView('F1')], { F1: 'a/logo.png' }, ['F1']);

    expect(referenceFile(input, 'F1')).toStrictEqual({
      path: 'a/logo.png',
      quarantined: false,
      originalFileName: 'logo.png',
      contentType: 'image/png',
      size: 61_234,
    });
  });

  test('ファイルIDがnullなら全ての項目をnullにする', () => {
    const input = documentInput([], {}, []);

    expect(referenceFile(input, null)).toStrictEqual(NULL_REFERENCE);
  });

  test('記録の無いファイルは全ての項目をnullにする', () => {
    const input = documentInput([], { F1: 'a/logo.png' }, ['F1']);

    expect(referenceFile(input, 'F1')).toStrictEqual(NULL_REFERENCE);
  });

  test('隔離中のファイルはパスをnullにして印とメタデータを残す', () => {
    const input = documentInput(
      [fileView('F1', { quarantined: true })],
      {},
      [],
    );

    expect(referenceFile(input, 'F1')).toStrictEqual({
      path: null,
      quarantined: true,
      originalFileName: 'logo.png',
      contentType: 'image/png',
      size: 61_234,
    });
  });

  test('格納できなかったファイルは計画にパスがあってもパスをnullにする', () => {
    const input = documentInput([fileView('F1')], { F1: 'a/logo.png' }, []);

    expect(referenceFile(input, 'F1')).toStrictEqual({
      path: null,
      quarantined: false,
      originalFileName: 'logo.png',
      contentType: 'image/png',
      size: 61_234,
    });
  });

  test('計画にパスが無いファイルは格納できた集合にあってもパスをnullにする', () => {
    const input = documentInput([fileView('F1')], {}, ['F1']);

    expect(referenceFile(input, 'F1').path).toBeNull();
  });
});
