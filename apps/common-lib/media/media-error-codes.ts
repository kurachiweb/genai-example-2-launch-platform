// アップロードできる利用者かの判定の拒否は、他の書き込みの拒否と同じコードにして既存の文言を出せるようにする
export type UploaderDenialCode = 'account_unavailable' | 'email_not_verified';

export type UploadErrorCode =
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
  | UploaderDenialCode;

export type FileAccessErrorCode =
  'unauthenticated' | 'not_found' | 'storage_unavailable';
