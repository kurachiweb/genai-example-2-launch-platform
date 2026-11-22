export interface ZipEntry {
  readonly path: string;
  readonly method: number;
  readonly utf8: boolean;
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06_05_4b_50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02_01_4b_50;
const END_OF_CENTRAL_DIRECTORY_MIN_BYTES = 22;
const UTF8_FLAG = 0x08_00;

function findEndOfCentralDirectory(view: DataView): number {
  for (
    let offset = view.byteLength - END_OF_CENTRAL_DIRECTORY_MIN_BYTES;
    offset >= 0;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('ZIPの終端の記録が見つからない');
}

// ZIPの中央ディレクトリを読み、展開では見えない圧縮の方式と、ファイル名のUTF-8の印を取り出す
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIPの中央ディレクトリが壊れている');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      path: new TextDecoder('utf-8').decode(nameBytes),
      method,
      utf8: (flags & UTF8_FLAG) !== 0,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
