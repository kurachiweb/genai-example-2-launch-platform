import { ATTACHMENT_MEDIA_TYPES } from '../../../common-lib/media/media-types.ts';
import {
  FILE_RELAY_PREFIX,
  UPLOAD_FILE_NAME_HEADER,
  UPLOAD_RELAY_PREFIX,
} from '../../../common-lib/media/upload-protocol.ts';
import { defineRelayRoute, type RelayRoute } from '../relay/relay-route.ts';

const MEDIA_RELAY_TIMEOUT_MS = 120_000;

const UPLOAD_UPSTREAM_PREFIX = '/internal/media/uploads/';

const FILE_UPSTREAM_PREFIX = '/internal/media/files/';

const decodeOrKeep = (encoded: string): string => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

// 接頭辞より後ろを1つの値として符号化し直し、/や不正な符号化を含んでも上流のパスの1つの区画に収める
const relayedSegmentOf = (url: URL, prefix: string): string =>
  encodeURIComponent(decodeOrKeep(url.pathname.slice(prefix.length)));

export const UPLOAD_RELAY_ROUTE: RelayRoute = defineRelayRoute({
  path: `${UPLOAD_RELAY_PREFIX}*`,
  methods: ['POST'],
  upstreamPath: (url) =>
    `${UPLOAD_UPSTREAM_PREFIX}${relayedSegmentOf(url, UPLOAD_RELAY_PREFIX)}`,
  acceptContentTypes: ATTACHMENT_MEDIA_TYPES,
  extraForwardedHeaders: ['content-length', UPLOAD_FILE_NAME_HEADER],
  timeoutMs: MEDIA_RELAY_TIMEOUT_MS,
});

export const FILE_DOWNLOAD_RELAY_ROUTE: RelayRoute = defineRelayRoute({
  path: `${FILE_RELAY_PREFIX}*`,
  methods: ['GET'],
  upstreamPath: (url) =>
    `${FILE_UPSTREAM_PREFIX}${relayedSegmentOf(url, FILE_RELAY_PREFIX)}`,
  timeoutMs: MEDIA_RELAY_TIMEOUT_MS,
});
