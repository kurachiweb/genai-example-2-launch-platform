import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import {
  type AttachmentCandidate,
  checkAttachmentSelection,
} from './attachment-selection.ts';

const USER_ID = '01JC0000000000000000000U01';
const OTHER_USER_ID = '01JC0000000000000000000U02';

const candidate = (
  id: string,
  overrides: Partial<AttachmentCandidate> = {},
): AttachmentCandidate => ({
  id,
  purpose: INQUIRY_ATTACHMENT_PURPOSE,
  ownerKind: 'user',
  ownerId: USER_ID,
  stored: true,
  deleted: false,
  byteSize: 1024,
  ...overrides,
});

const foundOf = (
  candidates: readonly AttachmentCandidate[],
): ReadonlyMap<string, AttachmentCandidate> =>
  new Map(candidates.map((file) => [file.id, file]));

const idsOf = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `file-${String(index)}`);

describe('checkAttachmentSelection', () => {
  test('添付が0件なら違反なしとする', () => {
    expect(checkAttachmentSelection([], new Map(), USER_ID)).toBeUndefined();
  });

  test('本人がアップロードした保存済みの問い合わせの添付は違反なしとする', () => {
    const files = [candidate('file-a'), candidate('file-b')];

    expect(
      checkAttachmentSelection(['file-a', 'file-b'], foundOf(files), USER_ID),
    ).toBeUndefined();
  });

  test('上限の件数ちょうどの添付は違反なしとする', () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount);
    const files = ids.map((id) => candidate(id));

    expect(
      checkAttachmentSelection(ids, foundOf(files), USER_ID),
    ).toBeUndefined();
  });

  test('上限の件数を超える添付はtoo-manyとする', () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount + 1);
    const files = ids.map((id) => candidate(id));

    expect(checkAttachmentSelection(ids, foundOf(files), USER_ID)).toEqual({
      kind: 'too-many',
    });
  });

  test('合計が上限ちょうどの添付は違反なしとする', () => {
    const half = INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes / 2;
    const files = [
      candidate('file-a', { byteSize: half }),
      candidate('file-b', { byteSize: half }),
    ];

    expect(
      checkAttachmentSelection(['file-a', 'file-b'], foundOf(files), USER_ID),
    ).toBeUndefined();
  });

  test('合計が上限を超える添付はtoo-largeとする', () => {
    const half = INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes / 2;
    const files = [
      candidate('file-a', { byteSize: half }),
      candidate('file-b', { byteSize: half + 1 }),
    ];

    expect(
      checkAttachmentSelection(['file-a', 'file-b'], foundOf(files), USER_ID),
    ).toEqual({ kind: 'too-large' });
  });

  test.each([
    { label: '存在しない', found: [] },
    {
      label: '他の利用者がアップロードした',
      found: [candidate('file-x', { ownerId: OTHER_USER_ID })],
    },
    {
      label: '管理者がアップロードした',
      found: [candidate('file-x', { ownerKind: 'admin', ownerId: USER_ID })],
    },
    {
      label: '主体がsystemの',
      found: [candidate('file-x', { ownerKind: 'system', ownerId: null })],
    },
    {
      label: '用途が問い合わせの添付でない',
      found: [candidate('file-x', { purpose: 'product-file' })],
    },
    {
      label: '保存が完了していない',
      found: [candidate('file-x', { stored: false })],
    },
    {
      label: '削除済みの',
      found: [candidate('file-x', { deleted: true })],
    },
  ])('$label ファイルはinvalidのIDに含める', ({ found }) => {
    expect(
      checkAttachmentSelection(
        ['file-a', 'file-x'],
        foundOf([candidate('file-a'), ...found]),
        USER_ID,
      ),
    ).toEqual({ kind: 'invalid', fileIds: ['file-x'] });
  });

  test('無効なファイルが複数あれば、重複を除いて要求の順にすべて挙げる', () => {
    const files = [
      candidate('file-a'),
      candidate('file-c', { ownerId: OTHER_USER_ID }),
      candidate('file-d', { deleted: true }),
    ];

    expect(
      checkAttachmentSelection(
        ['file-d', 'file-a', 'file-b', 'file-c', 'file-d', 'file-b'],
        foundOf(files),
        USER_ID,
      ),
    ).toEqual({ kind: 'invalid', fileIds: ['file-d', 'file-b', 'file-c'] });
  });

  test('重複したIDは1件として数え、上限の件数を超えない', () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount);
    const files = ids.map((id) => candidate(id));

    expect(
      checkAttachmentSelection([...ids, ...ids], foundOf(files), USER_ID),
    ).toBeUndefined();
  });

  test('重複したIDのサイズは1回だけ合計に加える', () => {
    const files = [
      candidate('file-a', {
        byteSize: INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes,
      }),
    ];

    expect(
      checkAttachmentSelection(['file-a', 'file-a'], foundOf(files), USER_ID),
    ).toBeUndefined();
  });

  test('件数の超過は無効なIDより先に判定する', () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount + 1);

    expect(checkAttachmentSelection(ids, new Map(), USER_ID)).toEqual({
      kind: 'too-many',
    });
  });

  test('無効なIDは合計の超過より先に判定する', () => {
    const files = [
      candidate('file-a', {
        byteSize: INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes,
      }),
      candidate('file-b', { ownerId: OTHER_USER_ID }),
    ];

    expect(
      checkAttachmentSelection(['file-a', 'file-b'], foundOf(files), USER_ID),
    ).toEqual({ kind: 'invalid', fileIds: ['file-b'] });
  });
});
