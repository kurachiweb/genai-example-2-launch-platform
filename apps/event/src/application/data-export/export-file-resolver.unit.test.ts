import { describe, expect, test } from 'bun:test';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import { ExportFileResolver } from './export-file-resolver.ts';

const CREATED_AT = new Date('2026-11-01T00:00:00.000Z');

function idOf(index: number): string {
  return `F-${String(index).padStart(4, '0')}`;
}

function mediaFile(
  id: string,
  overrides: Partial<MediaFileView> = {},
): MediaFileView {
  return {
    id,
    objectKey: `objects/${id}`,
    purpose: 'product_logo',
    storage: 'files',
    location: 'files',
    owner: { type: 'user', id: 'U-1' },
    originalFileName: `${id}.png`,
    contentType: 'image/png',
    byteSize: 1234,
    width: 100,
    height: 100,
    stored: true,
    attached: true,
    deletedAt: null,
    eraseRequested: false,
    moderationStatus: 'approved',
    quarantineReasons: [],
    quarantined: false,
    createdAt: CREATED_AT,
    ...overrides,
  } as MediaFileView;
}

function createResolver(
  records: readonly MediaFileView[],
  failure?: Error,
): { readonly resolver: ExportFileResolver; readonly calls: string[][] } {
  const calls: string[][] = [];
  const byId = new Map(records.map((record) => [record.id, record]));
  const files: Pick<MediaFiles, 'findMany'> = {
    findMany: (fileIds) => {
      calls.push([...fileIds]);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        new Map(
          fileIds.flatMap((fileId) => {
            const record = byId.get(fileId);
            return record === undefined ? [] : [[fileId, record] as const];
          }),
        ),
      );
    },
  };
  return { resolver: new ExportFileResolver(files as MediaFiles), calls };
}

describe('ExportFileResolver', () => {
  test('ファイルのIDが無いときは照会せず空の写しを返す', async () => {
    const { resolver, calls } = createResolver([]);

    const result = await resolver.resolve([]);

    expect(result.size).toBe(0);
    expect(calls).toEqual([]);
  });

  test('記録の項目から、ID・元のファイル名・種類・バイト数・隔離の印だけを写す', async () => {
    const { resolver } = createResolver([
      mediaFile('F-1', {
        originalFileName: 'logo.png',
        contentType: 'image/png',
        byteSize: 4321,
      }),
    ]);

    const result = await resolver.resolve(['F-1']);

    expect(result.get('F-1')).toEqual({
      fileId: 'F-1',
      originalFileName: 'logo.png',
      contentType: 'image/png',
      byteSize: 4321,
      quarantined: false,
    });
  });

  test('隔離の印をそのまま写す', async () => {
    const { resolver } = createResolver([
      mediaFile('F-1', { quarantined: true }),
      mediaFile('F-2', { quarantined: false }),
    ]);

    const result = await resolver.resolve(['F-1', 'F-2']);

    expect(result.get('F-1')?.quarantined).toBe(true);
    expect(result.get('F-2')?.quarantined).toBe(false);
  });

  test('記録の無いファイルは写しに含めない', async () => {
    const { resolver } = createResolver([mediaFile('F-1')]);

    const result = await resolver.resolve(['F-1', 'F-MISSING']);

    expect([...result.keys()]).toEqual(['F-1']);
  });

  test('重複したIDは1回だけ照会する', async () => {
    const { resolver, calls } = createResolver([mediaFile('F-1')]);

    const result = await resolver.resolve(['F-1', 'F-1', 'F-1']);

    expect(calls).toEqual([['F-1']]);
    expect(result.size).toBe(1);
  });

  test('90件ちょうどは1回、91件は90件と1件の2回に分けて照会し、全件を写す', async () => {
    const ids = Array.from({ length: 91 }, (_, index) => idOf(index));
    const { resolver, calls } = createResolver(ids.map((id) => mediaFile(id)));

    const exact = await resolver.resolve(ids.slice(0, 90));
    expect(calls.map((call) => call.length)).toEqual([90]);
    expect(exact.size).toBe(90);

    const over = await resolver.resolve(ids);
    expect(calls.slice(1).map((call) => call.length)).toEqual([90, 1]);
    expect(over.size).toBe(91);
  });

  test('重複を除いた後の件数で分ける', async () => {
    const ids = Array.from({ length: 90 }, (_, index) => idOf(index));
    const { resolver, calls } = createResolver(ids.map((id) => mediaFile(id)));

    await resolver.resolve([...ids, ...ids]);

    expect(calls.map((call) => call.length)).toEqual([90]);
  });

  test('照会の例外はそのまま投げる', async () => {
    const failure = new Error('D1が使えません');
    const { resolver } = createResolver([], failure);

    const caught = await resolver
      .resolve(['F-1'])
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
