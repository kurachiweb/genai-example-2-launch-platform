import {
  API_KEY_FEATURE_LABELS,
  API_KEY_LEVEL_LABELS,
  API_KEY_READ_FEATURES,
  API_KEY_WRITE_FEATURES,
  type ApiKeyFeature,
  type ApiKeyWriteLevel,
} from '../../common-lib/public-api/api-key-rules.ts';
import {
  PUBLIC_API_IP_RATE_LIMIT,
  PUBLIC_API_READ_RULE,
  PUBLIC_API_WRITE_RULE,
} from '../application/public-api/rate-limit-rules.ts';
import type { OpenApiDocumentInfo } from '../presentation/rest/rest-module.ts';

const SECONDS_PER_MINUTE = 60;

const READ_FEATURE_LEVELS: readonly ApiKeyWriteLevel[] = Object.freeze([
  'none',
  'read',
]);

const WRITE_FEATURE_LEVELS: readonly ApiKeyWriteLevel[] = Object.freeze([
  'none',
  'read',
  'read_write',
]);

function perWindow(seconds: number): string {
  return seconds % SECONDS_PER_MINUTE === 0
    ? `${String(seconds / SECONDS_PER_MINUTE)}分あたり`
    : `${String(seconds)}秒あたり`;
}

function scopeLines(
  features: readonly ApiKeyFeature[],
  levels: readonly ApiKeyWriteLevel[],
): readonly string[] {
  const choices = levels.map((level) => API_KEY_LEVEL_LABELS[level]).join('・');
  return features.map(
    (feature) => `- ${API_KEY_FEATURE_LABELS[feature]}: ${choices}`,
  );
}

const SCOPES_SECTION = [
  '## 権限スコープ',
  '',
  'APIキーの発行の時に、機能ごとに使える操作を選びます。各経路の説明に必要な権限を記載しています。権限の足りないAPIキーの要求は403(`insufficient_scope`)になります。',
  '',
  ...scopeLines(API_KEY_READ_FEATURES, READ_FEATURE_LEVELS),
  ...scopeLines(API_KEY_WRITE_FEATURES, WRITE_FEATURE_LEVELS),
].join('\n');

const RATE_LIMIT_SECTION = [
  '## レート制限',
  '',
  `APIキーの持ち主ごとに、全てのAPIキーの要求を合わせて、読み取りは${perWindow(PUBLIC_API_READ_RULE.windowSeconds)}${String(PUBLIC_API_READ_RULE.limit)}回、更新は${perWindow(PUBLIC_API_WRITE_RULE.windowSeconds)}${String(PUBLIC_API_WRITE_RULE.limit)}回までです。加えて、IPアドレスごとに${perWindow(PUBLIC_API_IP_RATE_LIMIT.periodSeconds)}${String(PUBLIC_API_IP_RATE_LIMIT.limit)}回までです。上限を超えた要求には429(\`rate_limit_exceeded\`)を返し、\`Retry-After\`ヘッダーに再度要求できるまでの秒数を付けます。`,
  '',
  'APIキーの持ち主ごとの回数を数えた要求の応答(上限を超えた429を含む)には、`X-RateLimit-Limit`(上限)・`X-RateLimit-Remaining`(残りの回数)・`X-RateLimit-Reset`(回数が戻る時刻のUNIX時間の秒)のヘッダーを付けます。これらのヘッダーは`Access-Control-Expose-Headers`で公開しないため、ブラウザのスクリプトからは読めません。',
].join('\n');

const DESCRIPTION = [
  '公開APIを使うと、プロダクト・ローンチ履歴・Upvote・コメント・評価・公開プロフィールなどの公開データを読み取り、自分のプロフィールとプロダクトの説明文を更新できます。',
  '',
  '## 認証',
  '',
  '要求の`Authorization`ヘッダーに`Bearer <APIキー>`の形でAPIキーを付けてください。APIキーは設定のAPIキーのページ(`/settings/api-keys`)で発行できます。APIキーが無い・Bearerの形式でない要求は401(`unauthenticated`)、無効なAPIキーの要求は401(`invalid_api_key`)になります。`/me`の下の経路は、APIキーの持ち主が停止中だと403(`account_unavailable`)になります。',
  '',
  SCOPES_SECTION,
  '',
  RATE_LIMIT_SECTION,
  '',
  '## ページ分け',
  '',
  'プロダクトの一覧(`GET /products`)はページ番号の方式で、問い合わせの`page`でページを指定し、`meta`に`total`・`page`・`per_page`・`total_pages`を返します。',
  '',
  'サポーターの一覧(`GET /products/{handle}/matches/{match_id}/supporters`)・Upvote履歴(`GET /users/{handle}/upvotes`)・コメントの一覧(`GET /products/{handle}/launches/{launch_id}/comments`)・自分のプロダクトの一覧(`GET /me/products`)は不透明なカーソルの方式で、`meta.has_next`が`true`のとき、応答の`meta.next_cursor`を次の要求の`cursor`にそのまま指定します。不正なカーソルの要求は400(`invalid_cursor`)になります。',
  '',
  'カテゴリの一覧(`GET /product-categories`)とローンチ履歴(`GET /products/{handle}/launches`)はページ分けをせず、全件を`meta`無しで返します。',
  '',
  '## 更新の本文',
  '',
  'プロフィールの更新(`PATCH /me/profile`)は、更新できない項目を含む本文を400(`validation_error`)で拒否します。プロダクトの説明文の更新(`PUT /me/products/{handle}/description`)は、説明文以外の項目を無視します。',
].join('\n');

// 渡した情報は既定の情報を項目ごとに合わせず丸ごと置き換えるため、題名と版も持たせる
export const PUBLIC_API_DOCUMENT_INFO: OpenApiDocumentInfo & {
  readonly description: string;
} = Object.freeze({
  title: 'Launch Stadium Public API',
  version: '1.0.0',
  description: DESCRIPTION,
});
