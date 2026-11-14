import { describe, expect, test } from 'bun:test';

import {
  UPLOAD_RETRY_LABEL,
  UPLOAD_STATUS_SENDING,
  UPLOAD_STATUS_UPLOADED,
  UPLOAD_STATUS_WAITING,
  uploadedAnnouncement,
  uploadingAnnouncement,
  uploadPendingSubmitMessage,
} from './media-upload-messages.ts';

describe('アップロードの送信の文言', () => {
  test('操作の名前とファイルごとの状態は体言止めにする', () => {
    expect(UPLOAD_RETRY_LABEL).toBe('再試行');
    expect(UPLOAD_STATUS_WAITING).toBe('送信待ち');
    expect(UPLOAD_STATUS_SENDING).toBe('送信中');
    expect(UPLOAD_STATUS_UPLOADED).toBe('アップロード済み');
  });

  test('送信中は、送っているファイルの名前を伝える', () => {
    expect(uploadingAnnouncement('logo.png')).toBe(
      'logo.pngを送信しています。',
    );
  });

  test('1件の成功は、ファイル名をアップロードしたことを伝える', () => {
    expect(uploadedAnnouncement(['logo.png'])).toBe(
      'logo.pngをアップロードしました。',
    );
  });

  test('複数の成功は、ファイル名を「、」でつなぎ、件数を3桁区切りで添える', () => {
    expect(uploadedAnnouncement(['a.png', 'b.pdf'])).toBe(
      'a.png、b.pdfの2件をアップロードしました。',
    );
    expect(
      uploadedAnnouncement(
        Array.from({ length: 1000 }, (_, index) => `${String(index)}.txt`),
      ),
    ).toMatch(/の1,000件をアップロードしました。$/u);
  });

  test('アップロードしたファイルが無いときは何も伝えない', () => {
    expect(uploadedAnnouncement([])).toBe('');
  });

  test('送信中に送信を止めた時は、主語のアップロードが終わってから送り直すよう案内する', () => {
    expect(uploadPendingSubmitMessage('ロゴ')).toBe(
      'ロゴのアップロードが終わってから、もう一度お試しください。',
    );
  });
});
