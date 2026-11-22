import { describe, expect, test } from 'bun:test';

import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_ENTRIES,
  ARCHIVE_PART_BYTES,
  ArchiveTooLargeError,
} from './archive-limits.ts';

describe('ZIPの上限', () => {
  test('合計の上限はZIP64を使わない最大の4GiB未満である', () => {
    expect(ARCHIVE_MAX_BYTES).toBe(4_294_967_295);
    expect(ARCHIVE_MAX_BYTES).toBe(2 ** 32 - 1);
  });

  test('格納する項目の上限は65,535件である', () => {
    expect(ARCHIVE_MAX_ENTRIES).toBe(65_535);
    expect(ARCHIVE_MAX_ENTRIES).toBe(2 ** 16 - 1);
  });

  test('アップロードの部分の大きさは10MiBで、R2の最小の部分の大きさ5MiB以上である', () => {
    expect(ARCHIVE_PART_BYTES).toBe(10_485_760);
    expect(ARCHIVE_PART_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });
});

describe('ArchiveTooLargeError', () => {
  test.each([['bytes'], ['entries']] as const)(
    '超えた上限%sを保持するErrorである',
    (limit) => {
      const error = new ArchiveTooLargeError(limit);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ArchiveTooLargeError);
      expect(error.name).toBe('ArchiveTooLargeError');
      expect(error.limit).toBe(limit);
    },
  );

  test('メッセージは超えた上限だけから決まり、利用者の内容を含まない', () => {
    expect(new ArchiveTooLargeError('bytes').message).toBe(
      'ZIPの合計の大きさが上限を超えました',
    );
    expect(new ArchiveTooLargeError('entries').message).toBe(
      'ZIPに格納するファイルの件数が上限を超えました',
    );
  });
});
