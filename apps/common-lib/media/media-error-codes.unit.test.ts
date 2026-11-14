import { describe, expectTypeOf, test } from 'bun:test';

import type {
  FileAccessErrorCode,
  UploadErrorCode,
  UploaderDenialCode,
} from './media-error-codes.ts';

describe('アップロードとファイルの取得のエラーコード', () => {
  test('アップロードのエラーコードは拒否の理由ごとのコードとアップロードできない利用者の拒否からなる', () => {
    expectTypeOf<UploadErrorCode>().toEqualTypeOf<
      | 'upload_purpose_not_found'
      | 'unauthenticated'
      | 'upload_forbidden'
      | 'content_length_required'
      | 'invalid_content_length'
      | 'file_too_large'
      | 'unsupported_file_type'
      | 'content_length_mismatch'
      | 'file_type_mismatch'
      | 'invalid_svg'
      | 'svg_declaration_not_allowed'
      | 'invalid_text_file'
      | 'image_unreadable'
      | 'image_dimensions_exceeded'
      | 'storage_unavailable'
      | 'account_unavailable'
      | 'email_not_verified'
    >();
  });

  test('アップロードできない利用者の拒否はアカウントを利用できない・メールアドレスの確認が必要の2つである', () => {
    expectTypeOf<UploaderDenialCode>().toEqualTypeOf<
      'account_unavailable' | 'email_not_verified'
    >();
    expectTypeOf<UploaderDenialCode>().toExtend<UploadErrorCode>();
  });

  test('ファイルの取得のエラーコードは未ログイン・見つからない・保存先の一時的な障害の3つである', () => {
    expectTypeOf<FileAccessErrorCode>().toEqualTypeOf<
      'unauthenticated' | 'not_found' | 'storage_unavailable'
    >();
  });
});
