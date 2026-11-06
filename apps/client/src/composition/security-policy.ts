import type { SecurityPolicySources } from '../../lib/server/http/security-policy.ts';

const STRIPE_JS_ORIGIN = 'https://js.stripe.com';

// Cloudflare Web Analyticsの計測スクリプトの配信元と計測値の送信先、Stripe.js(決済の入力欄・3Dセキュアの画面)とLinkの読み込み先と通信先。
// LinkはStripeの文書が`https://*.link.com`も求めるが、許可先の形の規則がワイルドカードを受け付けないため`https://link.com`だけを許可する。
// Apple Pay・Google PayはStripe.jsの埋め込み枠の中でPayment Request APIを使うため、`payment`をStripe.jsのオリジンにも許可する
export const CLIENT_SECURITY_POLICY: SecurityPolicySources = Object.freeze({
  scriptSrc: Object.freeze([
    'https://static.cloudflareinsights.com',
    STRIPE_JS_ORIGIN,
  ]),
  connectSrc: Object.freeze([
    'https://cloudflareinsights.com',
    'https://api.stripe.com',
    'https://link.com',
  ]),
  frameSrc: Object.freeze([
    STRIPE_JS_ORIGIN,
    'https://hooks.stripe.com',
    'https://link.com',
  ]),
  permissions: Object.freeze({
    payment: Object.freeze(['self', `"${STRIPE_JS_ORIGIN}"`]),
  }),
});
