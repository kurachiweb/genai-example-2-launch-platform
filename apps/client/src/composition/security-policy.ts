import type { SecurityPolicySources } from '../../lib/server/http/security-policy.ts';

// Cloudflare Web Analyticsの計測スクリプトの配信元と、計測値の送信先
export const CLIENT_SECURITY_POLICY: SecurityPolicySources = Object.freeze({
  scriptSrc: Object.freeze(['https://static.cloudflareinsights.com']),
  connectSrc: Object.freeze(['https://cloudflareinsights.com']),
});
