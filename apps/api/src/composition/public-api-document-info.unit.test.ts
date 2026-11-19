import { describe, expect, test } from 'bun:test';

import {
  API_KEY_FEATURE_LABELS,
  API_KEY_FEATURES,
  API_KEY_READ_FEATURES,
  API_KEY_WRITE_FEATURES,
} from '../../common-lib/public-api/api-key-rules.ts';
import { PUBLIC_API_DOCUMENT_INFO } from './public-api-document-info.ts';

const { description } = PUBLIC_API_DOCUMENT_INFO;

const lines = description.split('\n');

describe('公開APIの仕様書の説明', () => {
  test('既定の情報を丸ごと置き換えるため、題名・版・説明の全てを持つ', () => {
    expect(PUBLIC_API_DOCUMENT_INFO.title).toBe('Launch Stadium Public API');
    expect(PUBLIC_API_DOCUMENT_INFO.version).toBe('1.0.0');
    expect(description.length).toBeGreaterThan(0);
  });

  test('APIキーをBearerで送る認証と、APIキーの発行の場所を説明する', () => {
    expect(description).toContain('Authorization');
    expect(description).toContain('Bearer <APIキー>');
    expect(description).toContain('/settings/api-keys');
  });

  test('/meの下の経路は持ち主が停止中だと403(account_unavailable)になることを説明する', () => {
    expect(description).toContain(
      '`/me`の下の経路は、APIキーの持ち主が停止中だと403(`account_unavailable`)になります。',
    );
  });

  test('権限スコープの7機能を、機能ごとの1行で選べる値とともに説明する', () => {
    expect(API_KEY_FEATURES).toHaveLength(7);
    for (const feature of API_KEY_READ_FEATURES) {
      expect(lines).toContain(
        `- ${API_KEY_FEATURE_LABELS[feature]}: 無効・読み取り`,
      );
    }
    for (const feature of API_KEY_WRITE_FEATURES) {
      expect(lines).toContain(
        `- ${API_KEY_FEATURE_LABELS[feature]}: 無効・読み取り・読み書き`,
      );
    }
  });

  test('利用者単位の読み取り30回・書き込み15回と、IP単位の60回の1分あたりの上限を説明する', () => {
    expect(description).toContain('読み取りは1分あたり30回');
    expect(description).toContain('更新は1分あたり15回');
    expect(description).toContain('IPアドレスごとに1分あたり60回');
  });

  test('APIキーの発行の回数の上限は公開APIの経路の制限ではないため載せない', () => {
    expect(description).not.toContain('1時間');
  });

  test('プロダクトの一覧はページ番号の方式で、問い合わせのpageでページを指定する', () => {
    expect(description).toContain(
      'プロダクトの一覧(`GET /products`)はページ番号の方式で、問い合わせの`page`でページを指定し',
    );
  });

  test('カーソルの方式の4経路を挙げ、不正なカーソルのinvalid_cursorを説明する', () => {
    const cursorLine = lines.find((line) =>
      line.includes('`meta.next_cursor`'),
    );

    expect(cursorLine).toBeDefined();
    for (const path of [
      '`GET /products/{handle}/matches/{match_id}/supporters`',
      '`GET /users/{handle}/upvotes`',
      '`GET /products/{handle}/launches/{launch_id}/comments`',
      '`GET /me/products`',
    ]) {
      expect(cursorLine).toContain(path);
    }
    expect(cursorLine).toContain('400(`invalid_cursor`)');
  });

  test('カテゴリの一覧とローンチ履歴はページ分けをせず全件を返すことを説明する', () => {
    expect(description).toContain(
      'カテゴリの一覧(`GET /product-categories`)とローンチ履歴(`GET /products/{handle}/launches`)はページ分けをせず、全件を`meta`無しで返します。',
    );
  });

  test('回数の制限のヘッダーは回数を数えた要求の応答に付け、ブラウザから読めないことを説明する', () => {
    expect(description).toContain(
      'APIキーの持ち主ごとの回数を数えた要求の応答',
    );
    expect(description).toContain('X-RateLimit-Limit');
    expect(description).toContain('Access-Control-Expose-Headers');
  });
});
