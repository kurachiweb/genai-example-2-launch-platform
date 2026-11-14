import type { MediaFileView } from '../../lib/core/media/media-file.ts';

const BASE_FILE: MediaFileView = Object.freeze({
  id: '01JC0FILE000000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  purpose: 'inquiry-attachment',
  storage: 'files',
  location: 'files',
  owner: Object.freeze({ kind: 'user', id: '01JC0USER00000000000000001' }),
  originalFileName: 'document.pdf',
  contentType: 'application/pdf',
  byteSize: 1024,
  width: null,
  height: null,
  stored: true,
  attached: true,
  deletedAt: null,
  eraseRequested: false,
  moderationStatus: 'not_required',
  quarantineReasons: Object.freeze([]),
  quarantined: false,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

export function mediaFileViewOf(
  overrides: Partial<MediaFileView> = {},
): MediaFileView {
  return Object.freeze({ ...BASE_FILE, ...overrides });
}

export function imageFileViewOf(
  overrides: Partial<MediaFileView> = {},
): MediaFileView {
  return mediaFileViewOf({
    purpose: 'product-image',
    storage: 'images',
    location: 'quarantine',
    originalFileName: 'screenshot.png',
    contentType: 'image/png',
    width: 640,
    height: 480,
    moderationStatus: 'flagged',
    quarantineReasons: Object.freeze(['auto']),
    quarantined: true,
    ...overrides,
  });
}
