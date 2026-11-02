import { describe, expect, test } from 'bun:test';

import { AppError } from '../errors/app-error.ts';
import {
  MEDIA_RETRY_AFTER_SECONDS,
  MEDIA_UNAVAILABLE_MESSAGE,
} from './media-unavailable.ts';

describe('メディアの一時的な障害の文言と再試行の秒数', () => {
  test('文言規則の「アップロード・画像配信の一時的な障害(503)」の文言と5秒の再試行を持つ', () => {
    expect(MEDIA_UNAVAILABLE_MESSAGE).toBe(
      '現在ご利用いただけません。しばらく待ってから再度お試しください。',
    );
    expect(MEDIA_RETRY_AFTER_SECONDS).toBe(5);
  });

  test('503の共通エラーの再試行の秒数として受け付けられる', () => {
    const error = new AppError({
      kind: 'unavailable',
      code: 'storage_unavailable',
      message: MEDIA_UNAVAILABLE_MESSAGE,
      retryAfterSeconds: MEDIA_RETRY_AFTER_SECONDS,
    });

    expect(error.retryAfterSeconds).toBe(MEDIA_RETRY_AFTER_SECONDS);
  });
});
