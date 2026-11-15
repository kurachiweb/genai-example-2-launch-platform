import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import {
  errorReply,
  stubUploadFetch,
  uploadedFileOf,
  uploadedReply,
} from '../../test/fake-upload-fetch.ts';
import { createDocumentFile, createSvgFile } from '../../test/media-files.ts';
import { UnexpectedUploadResponseError } from '../../utilities/media/upload-request.ts';
import type { UploadConstraints } from '../../utilities/media/upload-constraints.ts';
import { useFileUpload } from './use-file-upload.ts';

vi.mock('../../start/observability/browser-error-reporting.ts', { spy: true });

const LOGO: UploadConstraints = {
  purpose: 'product-logo',
  allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
  maxBytes: 512_000,
  subjectLabel: 'ロゴ',
};

const UNEXPECTED_WITH_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const UNEXPECTED_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

type UploadedMock = ReturnType<
  typeof vi.fn<(files: readonly UploadedFile[]) => void>
>;

async function renderUpload(contactAvailable = true) {
  const onUploaded: UploadedMock = vi.fn();
  const hook = await renderHook(() =>
    useFileUpload({ constraints: LOGO, contactAvailable, onUploaded }),
  );
  return { ...hook, onUploaded };
}

beforeEach(() => {
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFileUpload', () => {
  test('ファイルを1件ずつ順に、用途の中継の経路へ確定した形式とファイル名で送る', async () => {
    const fetch = stubUploadFetch();
    const first = createSvgFile('ロゴ 1.svg');
    const second = createDocumentFile('logo.png', 'image/png', 64);
    const { result, act, onUploaded } = await renderUpload();

    await act(() => {
      result.current.start([first, second]);
    });

    await expect.poll(() => fetch.calls.length).toBe(1);
    expect(result.current.state).toEqual({
      status: 'uploading',
      fileName: 'ロゴ 1.svg',
      completed: 0,
    });
    expect(fetch.calls[0]).toMatchObject({
      path: '/_bff/uploads/product-logo',
      method: 'POST',
      contentType: 'image/svg+xml',
      fileNameHeader: encodeURIComponent('ロゴ 1.svg'),
    });
    expect(fetch.calls[0]?.body).toBe(first);

    await fetch.reply(uploadedReply(first, 'file-1'));
    await expect.poll(() => fetch.calls.length).toBe(2);
    expect(result.current.state).toEqual({
      status: 'uploading',
      fileName: 'logo.png',
      completed: 1,
    });
    expect(fetch.calls[1]?.contentType).toBe('image/png');
    expect(onUploaded).not.toHaveBeenCalled();

    await fetch.reply(uploadedReply(second, 'file-2'));
    await expect
      .poll(() => result.current.state)
      .toEqual({
        status: 'uploaded',
        files: [
          uploadedFileOf(first, 'file-1'),
          uploadedFileOf(second, 'file-2'),
        ],
      });
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith([
      uploadedFileOf(first, 'file-1'),
      uploadedFileOf(second, 'file-2'),
    ]);
  });

  test('送信中に始め直しても、重ねて送らない', async () => {
    const fetch = stubUploadFetch();
    const file = createSvgFile('logo.svg');
    const { result, act } = await renderUpload();

    await act(() => {
      result.current.start([file]);
    });
    await expect.poll(() => fetch.calls.length).toBe(1);
    await act(() => {
      result.current.start([createSvgFile('other.svg')]);
    });

    expect(fetch.calls).toHaveLength(1);
    expect(fetch.pendingCount()).toBe(1);
  });

  test('503は同じファイルで再試行でき、成功した分は失敗の時点で呼び出し元へ渡し、再試行で残りを渡す', async () => {
    const fetch = stubUploadFetch();
    const first = createSvgFile('first.svg');
    const second = createSvgFile('second.svg');
    const { result, act, onUploaded } = await renderUpload();

    await act(() => {
      result.current.start([first, second]);
    });
    await fetch.reply(uploadedReply(first, 'file-1'));
    await fetch.reply(errorReply(503, 'storage_unavailable'));

    await expect
      .poll(() => result.current.state)
      .toEqual({
        status: 'failed',
        message:
          '現在ご利用いただけません。しばらく待ってから再度お試しください。',
        retryable: true,
        completed: 1,
      });
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith([
      uploadedFileOf(first, 'file-1'),
    ]);

    await act(() => {
      result.current.retry();
    });
    await expect.poll(() => fetch.calls.length).toBe(3);
    expect(fetch.calls[2]?.body).toBe(second);
    await fetch.reply(uploadedReply(second, 'file-2'));

    await expect
      .poll(() => result.current.state)
      .toEqual({
        status: 'uploaded',
        files: [
          uploadedFileOf(first, 'file-1'),
          uploadedFileOf(second, 'file-2'),
        ],
      });
    expect(onUploaded).toHaveBeenCalledTimes(2);
    expect(onUploaded).toHaveBeenLastCalledWith([
      uploadedFileOf(second, 'file-2'),
    ]);
  });

  test('通信の失敗は再試行できる文言にする', async () => {
    const fetch = stubUploadFetch();
    const { result, act } = await renderUpload();

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await fetch.reply({ networkError: true });

    await expect
      .poll(() => result.current.state)
      .toEqual({
        status: 'failed',
        message: '通信に失敗しました。時間をおいて再度お試しください。',
        retryable: true,
        completed: 0,
      });
  });

  test('拒否は選び直しの文言にし、再試行しても送らない', async () => {
    const fetch = stubUploadFetch();
    const { result, act } = await renderUpload();

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await fetch.reply(errorReply(422, 'svg_declaration_not_allowed'));

    await expect
      .poll(() => result.current.state)
      .toEqual({
        status: 'failed',
        message:
          'このSVGは読み込めません。編集ソフトでSVGとして書き出し直してから選択してください。',
        retryable: false,
        completed: 0,
      });
    await act(() => {
      result.current.retry();
    });
    expect(fetch.calls).toHaveLength(1);
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each([
    [true, UNEXPECTED_WITH_CONTACT],
    [false, UNEXPECTED_WITHOUT_CONTACT],
  ])(
    '問い合わせの導線が%sなら、JSONでない本文の応答を想定外の文言にしてエラートラッキングへ送る',
    async (contactAvailable, message) => {
      const fetch = stubUploadFetch();
      const { result, act } = await renderUpload(contactAvailable);

      await act(() => {
        result.current.start([createSvgFile('logo.svg')]);
      });
      await fetch.reply({ status: 502, text: '<html>Bad Gateway</html>' });

      await expect
        .poll(() => result.current.state)
        .toEqual({ status: 'failed', message, retryable: false, completed: 0 });
      expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledOnce();
      const [reported] =
        vi.mocked(reportUnexpectedErrorInBrowser).mock.calls[0] ?? [];
      expect(reported).toBeInstanceOf(UnexpectedUploadResponseError);
      expect(reported).toMatchObject({ status: 502, code: undefined });
    },
  );

  test('中継の拒否は表に無いコードでも共通のエラー形式の文言をそのまま示し、エラートラッキングへ送らない', async () => {
    const fetch = stubUploadFetch();
    const message =
      'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。';
    const { result, act } = await renderUpload(false);

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await fetch.reply(errorReply(403, 'csrf_rejected', message));

    await expect
      .poll(() => result.current.state)
      .toEqual({ status: 'failed', message, retryable: false, completed: 0 });
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test('サーバー内部の失敗は本文の文言を示し、エラートラッキングへ送る', async () => {
    const fetch = stubUploadFetch();
    const message = '問題が発生しました。時間をおいて再度お試しください。';
    const { result, act } = await renderUpload();

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await fetch.reply(errorReply(500, 'internal_error', message));

    await expect
      .poll(() => result.current.state)
      .toEqual({ status: 'failed', message, retryable: false, completed: 0 });
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledOnce();
    const [reported] =
      vi.mocked(reportUnexpectedErrorInBrowser).mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(UnexpectedUploadResponseError);
    expect(reported).toMatchObject({ status: 500, code: 'internal_error' });
  });

  test('取り消すと待ちの状態に戻り、再試行しても送らない', async () => {
    const fetch = stubUploadFetch();
    const { result, act } = await renderUpload();

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await fetch.reply(errorReply(503, 'storage_unavailable'));
    await expect.poll(() => result.current.state.status).toBe('failed');

    await act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ status: 'idle' });
    await act(() => {
      result.current.retry();
    });
    expect(fetch.calls).toHaveLength(1);
  });

  test('送信中に外すと送信を中断し、結果を渡さない', async () => {
    const fetch = stubUploadFetch();
    const { result, act, unmount, onUploaded } = await renderUpload();

    await act(() => {
      result.current.start([createSvgFile('logo.svg')]);
    });
    await expect.poll(() => fetch.calls.length).toBe(1);
    await unmount();

    expect(fetch.calls[0]?.signal?.aborted).toBe(true);
    expect(fetch.pendingCount()).toBe(0);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  test('許可形式でないファイルは、呼び出し元の誤りとして送らずに拒否する', async () => {
    const fetch = stubUploadFetch();
    const { result } = await renderUpload();

    expect(() => {
      result.current.start([createDocumentFile('a.zip', 'application/zip', 1)]);
    }).toThrow(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });
});
