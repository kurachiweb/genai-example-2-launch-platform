import type { SecurityPolicySources } from '../../lib/server/http/security-policy.ts';

const STRIPE_JS_ORIGIN = 'https://js.stripe.com';

// Cloudflare Web Analyticsの計測スクリプトの配信元と計測値の送信先、Stripe.js(決済の入力欄・3Dセキュアの画面)とLinkの読み込み先と通信先。
// LinkはStripeの文書が`https://*.link.com`を求めるが、許可先の形の規則がワイルドカードを受け付けないため、文書とStripe.jsで確かめたサブドメインを個別に許可する。
// 認証の画面(`checkout.link.com`)を枠に、Stripe.jsの通信先(`checkout-cookies.link.com`)を接続先に、静的な資源(`statics.link.com`)を画像に許可する。
// Stripeがサブドメインを増やすとLinkの画面がCSPに阻まれ得るため、決済のE2EでCSPの違反が無いことを確かめる。
// Apple Pay・Google PayはStripe.jsの埋め込み枠の中でPayment Request APIを使うため、`payment`をStripe.jsのオリジンにも許可する
export const CLIENT_SECURITY_POLICY: SecurityPolicySources = Object.freeze({
  scriptSrc: Object.freeze([
    'https://static.cloudflareinsights.com',
    STRIPE_JS_ORIGIN,
  ]),
  imgSrc: Object.freeze(['https://statics.link.com']),
  connectSrc: Object.freeze([
    'https://cloudflareinsights.com',
    'https://api.stripe.com',
    'https://link.com',
    'https://checkout-cookies.link.com',
  ]),
  frameSrc: Object.freeze([
    STRIPE_JS_ORIGIN,
    'https://hooks.stripe.com',
    'https://link.com',
    'https://checkout.link.com',
  ]),
  permissions: Object.freeze({
    payment: Object.freeze(['self', `"${STRIPE_JS_ORIGIN}"`]),
  }),
});
