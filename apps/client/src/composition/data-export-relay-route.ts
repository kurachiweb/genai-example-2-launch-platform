import { DATA_EXPORT_DOWNLOAD_PREFIX } from '../../common-lib/data-export/data-export-rules.ts';
import {
  defineRelayRoute,
  type RelayRoute,
} from '../../lib/server/relay/relay-route.ts';

const DATA_EXPORT_RELAY_TIMEOUT_MS = 900_000;

const archiveUpstreamPathOf = (exportId: string): string =>
  `/internal/data-exports/${exportId}/archive`;

const decodeOrKeep = (encoded: string): string => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

// 接頭辞より後ろを1つの値として符号化し直し、/や不正な符号化を含んでも上流のパスの1つの区画に収める
const relayedExportIdOf = (url: URL): string =>
  encodeURIComponent(
    decodeOrKeep(url.pathname.slice(DATA_EXPORT_DOWNLOAD_PREFIX.length)),
  );

// 時間切れは本文の転送中も効くため、大きいZIPを遅い回線で転送し終える時間を見込んで15分にする
export const DATA_EXPORT_DOWNLOAD_RELAY_ROUTE: RelayRoute = defineRelayRoute({
  path: `${DATA_EXPORT_DOWNLOAD_PREFIX}*`,
  methods: ['GET'],
  upstreamPath: (url) => archiveUpstreamPathOf(relayedExportIdOf(url)),
  timeoutMs: DATA_EXPORT_RELAY_TIMEOUT_MS,
});
