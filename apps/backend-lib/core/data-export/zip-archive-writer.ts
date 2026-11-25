import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_ENTRIES,
  ArchiveTooLargeError,
} from './archive-limits.ts';

const TEXT_COMPRESSION_LEVEL = 6;
const END_OF_STREAM = new Uint8Array(0);

export interface ArchiveByteSink {
  write(chunk: Uint8Array): Promise<void>;
}

export interface ArchiveSummary {
  readonly entries: number;
  readonly bytes: number;
}

export interface ZipArchiveLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
}

export interface ZipArchiveWriter {
  addText(path: string, text: string, modifiedAt: Date): Promise<void>;
  addStream(
    path: string,
    body: ReadableStream<Uint8Array>,
    modifiedAt: Date,
  ): Promise<number>;
  finish(): Promise<ArchiveSummary>;
}

const DEFAULT_LIMITS: ZipArchiveLimits = Object.freeze({
  maxBytes: ARCHIVE_MAX_BYTES,
  maxEntries: ARCHIVE_MAX_ENTRIES,
});

// fflateの同期のZipは出力の断片を同期の関数へ渡すだけなので、断片を一旦配列へ積み、入力を1つ進めるたびに書き込み先へ順に流して完了を待つことで、メモリを入力の断片の大きさの範囲に収める
export function createZipArchiveWriter(
  sink: ArchiveByteSink,
  limits: ZipArchiveLimits = DEFAULT_LIMITS,
): ZipArchiveWriter {
  const pending: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error !== null) {
      throw error;
    }
    pending.push(chunk);
  });
  let entries = 0;
  let writtenBytes = 0;
  let busy = false;
  let finished = false;
  let failure: { readonly error: unknown } | undefined;

  async function drain(): Promise<void> {
    for (const chunk of pending.splice(0)) {
      if (chunk.length === 0) {
        continue;
      }
      if (chunk.length > limits.maxBytes - writtenBytes) {
        throw new ArchiveTooLargeError('bytes');
      }
      await sink.write(chunk);
      writtenBytes += chunk.length;
    }
  }

  function reserveEntry(): void {
    if (entries >= limits.maxEntries) {
      throw new ArchiveTooLargeError('entries');
    }
    entries += 1;
  }

  // 失敗した書き出しはZIPが途中で壊れているため、以降の操作は同じ例外で拒否する
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (failure !== undefined) {
      throw failure.error;
    }
    if (finished) {
      throw new Error('ZIPの書き出しは既に完了しています');
    }
    if (busy) {
      throw new Error('前のファイルの書き出しが終わる前に次の操作はできません');
    }
    busy = true;
    try {
      return await operation();
    } catch (error) {
      failure = { error };
      pending.length = 0;
      throw error;
    } finally {
      busy = false;
    }
  }

  async function copyStream(
    file: ZipPassThrough,
    body: ReadableStream<Uint8Array>,
  ): Promise<number> {
    const reader = body.getReader();
    let stored = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.length === 0) {
          continue;
        }
        stored += value.length;
        file.push(value, false);
        await drain();
      }
      file.push(END_OF_STREAM, true);
      await drain();
      return stored;
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  return {
    addText: (path, text, modifiedAt) =>
      exclusive(async () => {
        reserveEntry();
        const file = new ZipDeflate(path, { level: TEXT_COMPRESSION_LEVEL });
        file.mtime = modifiedAt;
        zip.add(file);
        file.push(new TextEncoder().encode(text), true);
        await drain();
      }),

    addStream: (path, body, modifiedAt) =>
      exclusive(() => {
        reserveEntry();
        const file = new ZipPassThrough(path);
        file.mtime = modifiedAt;
        zip.add(file);
        return copyStream(file, body);
      }),

    finish: () =>
      exclusive(async () => {
        zip.end();
        await drain();
        finished = true;
        return { entries, bytes: writtenBytes };
      }),
  };
}
