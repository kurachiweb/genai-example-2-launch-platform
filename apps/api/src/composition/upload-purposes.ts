import {
  ADMIN_AVATAR_MAX_BYTES,
  ADMIN_AVATAR_UPLOAD_PURPOSE,
} from '../../common-lib/admin/admin-avatar-upload.ts';
import {
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../common-lib/inquiry/inquiry-attachment-limits.ts';
import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
} from '../../common-lib/media/media-types.ts';
import {
  PRODUCT_LOGO_MAX_BYTES,
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_MAX_BYTES,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../common-lib/product/product-input-rules.ts';
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_PURPOSE,
} from '../../common-lib/profile/profile-input-rules.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../lib/core/media/upload-purpose.ts';

export const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  defineUploadPurpose({
    name: ADMIN_AVATAR_UPLOAD_PURPOSE,
    storage: 'images',
    uploaderKinds: ['admin'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: ADMIN_AVATAR_MAX_BYTES,
  }),
  defineUploadPurpose({
    name: INQUIRY_ATTACHMENT_PURPOSE,
    storage: 'files',
    uploaderKinds: ['user'],
    allowedTypes: ATTACHMENT_MEDIA_TYPES,
    maxBytes: INQUIRY_ATTACHMENT_LIMITS.maxFileBytes,
  }),
  defineUploadPurpose({
    name: PRODUCT_LOGO_PURPOSE,
    storage: 'images',
    uploaderKinds: ['user'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: PRODUCT_LOGO_MAX_BYTES,
  }),
  defineUploadPurpose({
    name: PRODUCT_SCREENSHOT_PURPOSE,
    storage: 'images',
    uploaderKinds: ['user'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: PRODUCT_SCREENSHOT_MAX_BYTES,
  }),
  defineUploadPurpose({
    name: USER_AVATAR_PURPOSE,
    storage: 'images',
    uploaderKinds: ['user'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: USER_AVATAR_MAX_BYTES,
  }),
];
