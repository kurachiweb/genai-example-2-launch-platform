// ZIP64を使わず、fflateが書き出せる範囲に収める(4GiB未満・65,535件)
export const ARCHIVE_MAX_BYTES = 4_294_967_295;

export const ARCHIVE_MAX_ENTRIES = 65_535;

export const ARCHIVE_PART_BYTES = 10_485_760;

export type ArchiveLimit = 'bytes' | 'entries';

const ARCHIVE_TOO_LARGE_MESSAGES: Readonly<Record<ArchiveLimit, string>> =
  Object.freeze({
    bytes: 'ZIPの合計の大きさが上限を超えました',
    entries: 'ZIPに格納するファイルの件数が上限を超えました',
  });

// 呼び出し側のログやエラートラッキングへ利用者の内容が漏れないよう、メッセージは超えた上限だけから決める
export class ArchiveTooLargeError extends Error {
  override readonly name = 'ArchiveTooLargeError';
  readonly limit: ArchiveLimit;

  constructor(limit: ArchiveLimit) {
    super(ARCHIVE_TOO_LARGE_MESSAGES[limit]);
    this.limit = limit;
  }
}
