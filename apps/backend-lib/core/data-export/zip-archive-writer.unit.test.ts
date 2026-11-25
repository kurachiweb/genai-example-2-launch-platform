import { describe, expect, test } from 'bun:test';

import { unzipSync } from 'fflate';

import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_ENTRIES,
  ArchiveTooLargeError,
} from './archive-limits.ts';
import { createPartChunker } from './part-chunker.ts';
import {
  type ArchiveByteSink,
  type ZipArchiveLimits,
  createZipArchiveWriter,
} from './zip-archive-writer.ts';

const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MODIFIED_AT = new Date(2026, 10, 22, 12, 34, 56);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface CentralEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly compressedSize: number;
  readonly size: number;
}

class MemorySink implements ArchiveByteSink {
  readonly chunks: Uint8Array[] = [];

  write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(Uint8Array.from(chunk));
    return Promise.resolve();
  }

  bytes(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
}

function readCentralEntries(zip: Uint8Array): readonly CentralEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endOffset = zip.length - 22;
  const count = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(offset, true)).toBe(CENTRAL_SIGNATURE);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength)),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      dosTime: view.getUint16(offset + 12, true),
      dosDate: view.getUint16(offset + 14, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readFirstLocalFlags(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  expect(view.getUint32(0, true)).toBe(LOCAL_SIGNATURE);
  return view.getUint16(6, true);
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('拒否されるはずの操作が成功しました');
}

function sameBytes(
  actual: Uint8Array | undefined,
  expected: Uint8Array,
): boolean {
  return actual !== undefined && Buffer.from(actual).equals(expected);
}

function bytesOf(length: number, seed = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 256);
}

async function writeSample(
  sink: ArchiveByteSink,
  limits?: ZipArchiveLimits,
): Promise<{ readonly entries: number; readonly bytes: number }> {
  const writer = createZipArchiveWriter(sink, limits);
  await writer.addText('a.json', '{"a":1}\n', MODIFIED_AT);
  await writer.addStream('b.bin', streamOf([bytesOf(100)]), MODIFIED_AT);
  return writer.finish();
}

describe('createZipArchiveWriter', () => {
  test('テキストと格納するファイルを書いたZIPを展開すると、元の内容と順序が戻る', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);
    const image = bytesOf(70_000, 3);

    await writer.addText('manifest.json', '{"version":1}\n', MODIFIED_AT);
    await writer.addStream(
      'images/p1.png',
      streamOf([image.subarray(0, 30_000), image.subarray(30_000)]),
      MODIFIED_AT,
    );
    await writer.addText('README.txt', '説明\n', MODIFIED_AT);
    await writer.finish();

    const unzipped = unzipSync(sink.bytes());
    expect(Object.keys(unzipped)).toEqual([
      'manifest.json',
      'images/p1.png',
      'README.txt',
    ]);
    expect(decoder.decode(unzipped['manifest.json'])).toBe('{"version":1}\n');
    expect(sameBytes(unzipped['images/p1.png'], image)).toBe(true);
    expect(decoder.decode(unzipped['README.txt'])).toBe('説明\n');
  });

  test('テキストは圧縮され、ストリームのファイルは圧縮されずに格納される', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);
    const text = '{"key":"value"}\n'.repeat(2_000);
    const image = bytesOf(5_000, 9);

    await writer.addText('data.json', text, MODIFIED_AT);
    await writer.addStream('image.png', streamOf([image]), MODIFIED_AT);
    await writer.finish();

    const [textEntry, imageEntry] = readCentralEntries(sink.bytes());
    expect(textEntry?.method).toBe(METHOD_DEFLATE);
    expect(textEntry?.size).toBe(encoder.encode(text).length);
    expect(textEntry?.compressedSize).toBeLessThan(textEntry?.size ?? 0);
    expect(imageEntry?.method).toBe(METHOD_STORED);
    expect(imageEntry?.compressedSize).toBe(5_000);
    expect(imageEntry?.size).toBe(5_000);
  });

  test('大きさを先に知らないため、全ての項目がデータ記述子(ビット3)で書かれる', async () => {
    const sink = new MemorySink();
    await writeSample(sink);

    const entries = readCentralEntries(sink.bytes());
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.flags & DATA_DESCRIPTOR_FLAG).toBe(DATA_DESCRIPTOR_FLAG);
    }
  });

  test('非ASCIIのファイル名ではUTF-8の印(フラグのビット11)が立ち、ASCIIだけの名前では立たない', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);

    await writer.addText('日本語/データ😀.json', '{}\n', MODIFIED_AT);
    await writer.addStream(
      'plain/photo.png',
      streamOf([bytesOf(10)]),
      MODIFIED_AT,
    );
    await writer.addText('ñandú/ü.txt', 'x', MODIFIED_AT);
    await writer.finish();

    const zip = sink.bytes();
    const [japanese, ascii, latin] = readCentralEntries(zip);
    expect(japanese?.name).toBe('日本語/データ😀.json');
    expect((japanese?.flags ?? 0) & UTF8_FLAG).toBe(UTF8_FLAG);
    expect(ascii?.name).toBe('plain/photo.png');
    expect((ascii?.flags ?? 0) & UTF8_FLAG).toBe(0);
    expect((latin?.flags ?? 0) & UTF8_FLAG).toBe(UTF8_FLAG);
    expect(readFirstLocalFlags(zip) & UTF8_FLAG).toBe(UTF8_FLAG);
  });

  test('日本語のファイル名のZIPを展開すると、名前がUTF-8のまま戻る', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);

    await writer.addStream(
      '添付/写真 1.png',
      streamOf([bytesOf(4)]),
      MODIFIED_AT,
    );
    await writer.finish();

    expect(Object.keys(unzipSync(sink.bytes()))).toEqual(['添付/写真 1.png']);
  });

  test('更新日時がZIPの日付と時刻に書かれる', async () => {
    const sink = new MemorySink();
    await writeSample(sink);

    const [entry] = readCentralEntries(sink.bytes());
    const date = entry?.dosDate ?? 0;
    const time = entry?.dosTime ?? 0;
    expect(1980 + (date >> 9)).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(11);
    expect(date & 0x1f).toBe(22);
    expect(time >> 11).toBe(12);
    expect((time >> 5) & 0x3f).toBe(34);
    expect((time & 0x1f) * 2).toBe(56);
  });

  test('addStreamは格納したバイト数を返し、空のストリームも空のファイルとして書ける', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);

    const stored = await writer.addStream(
      'a.bin',
      streamOf([bytesOf(10), new Uint8Array(0), bytesOf(5)]),
      MODIFIED_AT,
    );
    const empty = await writer.addStream(
      'empty.bin',
      streamOf([]),
      MODIFIED_AT,
    );
    await writer.addText('empty.txt', '', MODIFIED_AT);
    await writer.finish();

    expect(stored).toBe(15);
    expect(empty).toBe(0);
    const unzipped = unzipSync(sink.bytes());
    expect(unzipped['a.bin']).toHaveLength(15);
    expect(unzipped['empty.bin']).toHaveLength(0);
    expect(unzipped['empty.txt']).toHaveLength(0);
  });

  test('項目が無くても有効な空のZIPを書き、件数とバイト数を返す', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);

    const summary = await writer.finish();

    expect(summary).toEqual({ entries: 0, bytes: 22 });
    expect(sink.bytes()).toHaveLength(22);
    expect(Object.keys(unzipSync(sink.bytes()))).toEqual([]);
  });

  test('finishは項目数と書き込み先へ渡した合計のバイト数を返す', async () => {
    const sink = new MemorySink();

    const summary = await writeSample(sink);

    expect(summary.entries).toBe(2);
    expect(summary.bytes).toBe(sink.bytes().length);
  });

  test('ストリームの断片ごとに、書き込み先の完了を待ってから次の断片を読む(背圧)', async () => {
    const events: string[] = [];
    let writes = 0;
    const sink: ArchiveByteSink = {
      async write(chunk) {
        writes += 1;
        const current = writes;
        events.push(`write-start:${String(current)}:${String(chunk.length)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`write-end:${String(current)}`);
      },
    };
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          events.push(`read:${String(pulled)}`);
          if (pulled > 3) {
            controller.close();
            return;
          }
          controller.enqueue(bytesOf(10, pulled));
        },
      },
      { highWaterMark: 0 },
    );
    const writer = createZipArchiveWriter(sink);

    await writer.addStream('a.bin', body, MODIFIED_AT);

    const reads = events.filter((event) => event.startsWith('read:'));
    expect(reads).toHaveLength(4);
    for (const [index, read] of reads.entries()) {
      const next = reads[index + 1];
      if (next === undefined) {
        continue;
      }
      const between = events.slice(events.indexOf(read), events.indexOf(next));
      const starts = between.filter((event) => event.startsWith('write-start'));
      const ends = between.filter((event) => event.startsWith('write-end'));
      expect(starts.length).toBe(ends.length);
      expect(starts.length).toBeGreaterThan(0);
    }
  });

  test('書き込み先へは出力の断片が出た順に、1つずつ完了を待って渡される', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const received: Uint8Array[] = [];
    const sink: ArchiveByteSink = {
      async write(chunk) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        received.push(Uint8Array.from(chunk));
        inFlight -= 1;
      },
    };
    const writer = createZipArchiveWriter(sink);

    await writer.addText('a.txt', 'hello', MODIFIED_AT);
    await writer.addStream('b.bin', streamOf([bytesOf(8)]), MODIFIED_AT);
    await writer.finish();

    expect(maxInFlight).toBe(1);
    const merged = new Uint8Array(received.reduce((s, c) => s + c.length, 0));
    let offset = 0;
    for (const chunk of received) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    expect(Object.keys(unzipSync(merged))).toEqual(['a.txt', 'b.bin']);
  });

  test('書き込み先が失敗すると、その例外がそのまま呼び出し側へ伝わる', async () => {
    const failure = new Error('書き込みに失敗');
    const sink: ArchiveByteSink = { write: () => Promise.reject(failure) };
    const writer = createZipArchiveWriter(sink);

    expect(
      await rejectionOf(
        writer.addStream('a.bin', streamOf([bytesOf(10)]), MODIFIED_AT),
      ),
    ).toBe(failure);
  });

  test('ストリームの読み取りが失敗すると、その例外が伝わり書き出しは続けられない', async () => {
    const failure = new Error('読み取りに失敗');
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw failure;
      },
    });
    const writer = createZipArchiveWriter(new MemorySink());

    expect(
      await rejectionOf(writer.addStream('a.bin', body, MODIFIED_AT)),
    ).toBe(failure);
    expect(await rejectionOf(writer.addText('b.txt', 'x', MODIFIED_AT))).toBe(
      failure,
    );
    expect(await rejectionOf(writer.finish())).toBe(failure);
  });

  test('finishの後に項目を足したり、もう一度finishしたりすると拒否する', async () => {
    const writer = createZipArchiveWriter(new MemorySink());
    await writer.finish();

    expect(
      await rejectionOf(writer.addText('a.txt', 'x', MODIFIED_AT)),
    ).toBeInstanceOf(Error);
    expect(
      await rejectionOf(writer.addStream('b.bin', streamOf([]), MODIFIED_AT)),
    ).toBeInstanceOf(Error);
    expect(await rejectionOf(writer.finish())).toBeInstanceOf(Error);
  });

  test('1つのファイルを書いている途中に別のファイルを足そうとすると拒否する', async () => {
    const writer = createZipArchiveWriter(new MemorySink());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await gate;
        controller.close();
      },
    });

    const first = writer.addStream('slow.bin', slow, MODIFIED_AT);
    expect(
      await rejectionOf(writer.addText('b.txt', 'x', MODIFIED_AT)),
    ).toBeInstanceOf(Error);
    release();
    await first;
  });
});

describe('createZipArchiveWriter の上限', () => {
  test('既定の上限はZIPの上限の規則(1.3)の値である', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink);
    await writer.addText('a.txt', 'x', MODIFIED_AT);

    expect(ARCHIVE_MAX_BYTES).toBe(4_294_967_295);
    expect(ARCHIVE_MAX_ENTRIES).toBe(65_535);
    expect(await writer.finish()).toEqual({
      entries: 1,
      bytes: sink.bytes().length,
    });
  });

  test('項目数が上限ちょうどなら成功し、1件超えると項目数の上限超過の例外になる', async () => {
    const limits = { maxBytes: ARCHIVE_MAX_BYTES, maxEntries: 3 };
    const ok = createZipArchiveWriter(new MemorySink(), limits);
    await ok.addText('1.txt', 'x', MODIFIED_AT);
    await ok.addStream('2.bin', streamOf([bytesOf(3)]), MODIFIED_AT);
    await ok.addText('3.txt', 'x', MODIFIED_AT);
    expect(await ok.finish()).toMatchObject({ entries: 3 });

    const sink = new MemorySink();
    const over = createZipArchiveWriter(sink, limits);
    await over.addText('1.txt', 'x', MODIFIED_AT);
    await over.addText('2.txt', 'x', MODIFIED_AT);
    await over.addText('3.txt', 'x', MODIFIED_AT);
    const writtenBefore = sink.chunks.length;

    const failure = await over
      .addStream('4.bin', streamOf([bytesOf(3)]), MODIFIED_AT)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ArchiveTooLargeError);
    expect((failure as ArchiveTooLargeError).limit).toBe('entries');
    expect(sink.chunks).toHaveLength(writtenBefore);
    expect(await rejectionOf(over.addText('5.txt', 'x', MODIFIED_AT))).toBe(
      failure,
    );
  });

  test('テキストの追加でも項目数が上限を1件超えると上限超過の例外になる', async () => {
    const writer = createZipArchiveWriter(new MemorySink(), {
      maxBytes: ARCHIVE_MAX_BYTES,
      maxEntries: 1,
    });
    await writer.addText('1.txt', 'x', MODIFIED_AT);

    expect(
      await rejectionOf(writer.addText('2.txt', 'x', MODIFIED_AT)),
    ).toMatchObject({ name: 'ArchiveTooLargeError', limit: 'entries' });
  });

  test('合計のバイト数が上限ちょうどなら成功し、1バイト超えるとバイト数の上限超過の例外になる', async () => {
    const reference = new MemorySink();
    const total = (await writeSample(reference)).bytes;

    const exactSink = new MemorySink();
    const exact = await writeSample(exactSink, {
      maxBytes: total,
      maxEntries: ARCHIVE_MAX_ENTRIES,
    });
    expect(exact.bytes).toBe(total);
    expect(exactSink.bytes()).toEqual(reference.bytes());

    const overSink = new MemorySink();
    const failure = await writeSample(overSink, {
      maxBytes: total - 1,
      maxEntries: ARCHIVE_MAX_ENTRIES,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ArchiveTooLargeError);
    expect((failure as ArchiveTooLargeError).limit).toBe('bytes');
    expect(overSink.bytes().length).toBeLessThanOrEqual(total - 1);
  });

  test('ストリームの途中で合計が上限を超えると、超えた分を書き込み先へ渡さずに例外になる', async () => {
    const sink = new MemorySink();
    const writer = createZipArchiveWriter(sink, {
      maxBytes: 1_000,
      maxEntries: ARCHIVE_MAX_ENTRIES,
    });
    const chunks = Array.from({ length: 50 }, (_, index) =>
      bytesOf(100, index),
    );
    let read = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[read];
        read += 1;
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    expect(
      await rejectionOf(writer.addStream('big.bin', body, MODIFIED_AT)),
    ).toMatchObject({ name: 'ArchiveTooLargeError', limit: 'bytes' });
    expect(sink.bytes().length).toBeLessThanOrEqual(1_000);
    expect(read).toBeLessThan(50);
  });
});

describe('createZipArchiveWriter と PartChunker の組み合わせ', () => {
  test('書き込み先で均一な部分に区切っても、つなげたZIPが展開できる', async () => {
    const partBytes = 4_096;
    const chunker = createPartChunker(partBytes);
    const parts: Uint8Array[] = [];
    const sink: ArchiveByteSink = {
      write(chunk) {
        parts.push(...chunker.push(chunk));
        return Promise.resolve();
      },
    };
    const writer = createZipArchiveWriter(sink);
    const image = bytesOf(100_000, 5);
    const pieces = Array.from({ length: 10 }, (_, index) =>
      image.subarray(index * 10_000, (index + 1) * 10_000),
    );

    await writer.addStream('image.bin', streamOf(pieces), MODIFIED_AT);
    await writer.addText('data.json', '{"n":1}\n'.repeat(1_000), MODIFIED_AT);
    const summary = await writer.finish();
    const last = chunker.flush();
    if (last !== undefined) {
      parts.push(last);
    }

    expect(parts.slice(0, -1).every((part) => part.length === partBytes)).toBe(
      true,
    );
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(
      summary.bytes,
    );
    const merged = new Uint8Array(summary.bytes);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    const unzipped = unzipSync(merged);
    expect(sameBytes(unzipped['image.bin'], image)).toBe(true);
    expect(decoder.decode(unzipped['data.json'])).toBe(
      '{"n":1}\n'.repeat(1_000),
    );
  });
});
