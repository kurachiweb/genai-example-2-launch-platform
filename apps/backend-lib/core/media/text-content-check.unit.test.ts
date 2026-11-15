import { describe, expect, test } from 'bun:test';

import {
  createTextContentCheck,
  TextContentError,
} from './text-content-check.ts';

const encoder = new TextEncoder();

const utf8 = (text: string): Uint8Array => encoder.encode(text);

const streamOf = (chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  chunks.reduce((offset, chunk) => {
    joined.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  return joined;
};

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const received: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return concat(received);
    }
    received.push(value);
  }
}

const checked = (chunks: readonly Uint8Array[]): Promise<Uint8Array> =>
  readAll(streamOf(chunks).pipeThrough(createTextContentCheck()));

async function failureOf(chunks: readonly Uint8Array[]): Promise<unknown> {
  try {
    await checked(chunks);
  } catch (error) {
    return error;
  }
  throw new Error('流れが失敗しませんでした');
}

describe('createTextContentCheck', () => {
  test('正常なテキストを変えずに流す', async () => {
    const chunks = [utf8('hello, '), utf8('world\n'), utf8('2行目\r\n\t末尾')];

    expect(await checked(chunks)).toEqual(concat(chunks));
  });

  test('空の流れをそのまま終える', async () => {
    expect(await checked([])).toEqual(new Uint8Array(0));
  });

  test('空の断片を含む流れを受け付ける', async () => {
    const chunks = [new Uint8Array(0), utf8('abc'), new Uint8Array(0)];

    expect(await checked(chunks)).toEqual(utf8('abc'));
  });

  test('BOM付きのテキストをBOMごと変えずに流す', async () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('本文')]);

    expect(await checked([bytes])).toEqual(bytes);
  });

  test('断片の境界で分かれた3バイトの文字を受け付ける', async () => {
    const bytes = utf8('あい');

    expect(
      await checked([
        bytes.subarray(0, 1),
        bytes.subarray(1, 4),
        bytes.subarray(4),
      ]),
    ).toEqual(bytes);
  });

  test('4バイトの絵文字を1バイトずつの断片に分けても受け付ける', async () => {
    const bytes = utf8('a😀b');
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));

    expect(await checked(chunks)).toEqual(bytes);
  });

  test.each([
    ['最初の断片', [utf8('a\u0000b'), utf8('c')]],
    ['途中の断片', [utf8('abc'), utf8('d\u0000'), utf8('e')]],
    ['最後の断片', [utf8('abc'), Uint8Array.of(0x00)]],
  ])('%sのNUL文字で流れを失敗させる', async (_label, chunks) => {
    const failure = await failureOf(chunks);

    expect(failure).toBeInstanceOf(TextContentError);
    expect(failure).toMatchObject({
      name: 'TextContentError',
      reason: 'nul_character',
    });
  });

  test.each([
    ['UTF-8として不正なバイト', [utf8('abc'), Uint8Array.of(0xff)]],
    ['Shift_JISの本文', [Uint8Array.of(0x83, 0x65, 0x83, 0x4c)]],
    ['サロゲートを符号化したバイト列', [Uint8Array.of(0xed, 0xa0, 0x80)]],
    ['冗長な符号化の/', [Uint8Array.of(0xc0, 0xaf)]],
    ['後続のバイトを欠いた先頭のバイト', [Uint8Array.of(0xe3, 0x41)]],
    [
      '断片の境界の後で続かない多バイト文字',
      [Uint8Array.of(0xe3, 0x81), utf8('a')],
    ],
  ])('%sで流れを失敗させる', async (_label, chunks) => {
    const failure = await failureOf(chunks);

    expect(failure).toBeInstanceOf(TextContentError);
    expect(failure).toMatchObject({ reason: 'invalid_utf8' });
  });

  test('末尾で途切れた不完全なUTF-8を、流れの終わりで失敗させる', async () => {
    const bytes = utf8('あ');

    const failure = await failureOf([utf8('abc'), bytes.subarray(0, 2)]);

    expect(failure).toBeInstanceOf(TextContentError);
    expect(failure).toMatchObject({ reason: 'invalid_utf8' });
  });

  test('失敗の文言に本文の内容を含めない', async () => {
    const failure = await failureOf([utf8('secret-value\u0000')]);

    expect(failure).toBeInstanceOf(TextContentError);
    expect((failure as Error).message).not.toContain('secret-value');
  });

  test('違反の前に検査した断片は流し、違反のある断片は流さない', async () => {
    const received: Uint8Array[] = [];
    const sink = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array) {
        received.push(chunk);
      },
    });

    const piping = streamOf([utf8('ok'), utf8('ng\u0000')])
      .pipeThrough(createTextContentCheck())
      .pipeTo(sink);

    const failure: unknown = await piping.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TextContentError);
    expect(received).toEqual([utf8('ok')]);
  });

  test('検査の部品ごとに復号の状態を分ける', async () => {
    const bytes = utf8('あ');
    const first = createTextContentCheck();
    const second = createTextContentCheck();

    const [left, right] = await Promise.all([
      readAll(
        streamOf([bytes.subarray(0, 1), bytes.subarray(1)]).pipeThrough(first),
      ),
      readAll(streamOf([utf8('b')]).pipeThrough(second)),
    ]);

    expect(left).toEqual(bytes);
    expect(right).toEqual(utf8('b'));
  });
});
