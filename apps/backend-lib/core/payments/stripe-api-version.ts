// Webhook endpointのAPI版と同じ値にする。stripeパッケージの型は固定のAPI版だけを受け付けるため、パッケージを更新するときは両方を合わせて変える
export const STRIPE_API_VERSION = '2026-10-28.endive';

// ダッシュボードで決済の導線を見分けるための名前。Stripeの推奨に従い、末尾に8文字の英字を付ける
export const CHECKOUT_INTEGRATION_IDENTIFIER = 'checkout-elements-qhzwtmrk';
