import { describe, expect, test } from 'bun:test';

import {
  commentsOfProductPath,
  EMPTY_PERIOD_QUERY,
  emptyCommentsPath,
  emptyHelpArticlesPath,
  emptyInquiriesPath,
  emptyRatingsPath,
  emptyReportsPath,
  legalEditorPath,
  legalRevisionPath,
  productsByHandlePath,
  QUARANTINED_IMAGE_PATHS,
  ratingsOfProductPath,
  SPONSORSHIP_FILTER_PATHS,
  usersByEmailPath,
} from './admin-route-urls.ts';

describe('管理者側の経路の絞り込みのパス', () => {
  test('メールアドレスの記号を符号化して利用者の一覧を絞り込む', () => {
    expect(usersByEmailPath('e2e+a@test.example')).toBe(
      '/users?email=e2e%2Ba%40test.example',
    );
  });

  test('ハンドルでプロダクト・コメント・評価の一覧を絞り込む', () => {
    expect(productsByHandlePath('e2e-product')).toBe(
      '/products?handle=e2e-product',
    );
    expect(commentsOfProductPath('e2e-product')).toBe(
      '/comments?productHandle=e2e-product',
    );
    expect(ratingsOfProductPath('e2e-product')).toBe(
      '/ratings?productHandle=e2e-product',
    );
  });

  test('0件の状態のパスは一致しない語や期間を条件に持つ', () => {
    expect(emptyCommentsPath('none1')).toBe('/comments?authorHandle=none1');
    expect(emptyRatingsPath('none1')).toBe('/ratings?raterHandle=none1');
    expect(emptyHelpArticlesPath('none1')).toBe('/help-articles?creator=none1');
    expect(emptyInquiriesPath()).toBe(`/inquiries?${EMPTY_PERIOD_QUERY}`);
    expect(emptyReportsPath()).toBe(`/reports?${EMPTY_PERIOD_QUERY}`);
    expect(EMPTY_PERIOD_QUERY).toBe('from=2000-01-01&to=2000-01-02');
  });

  test('隔離画像の一覧は4つの理由ごと、スポンサー広告の一覧は5つの掲載状況と3つのティアの全組み合わせのパスを持つ', () => {
    expect(QUARANTINED_IMAGE_PATHS).toEqual([
      '/media-moderation?reason=auto',
      '/media-moderation?reason=product_hidden',
      '/media-moderation?reason=user_suspended',
      '/media-moderation?reason=admin_action',
    ]);
    expect(SPONSORSHIP_FILTER_PATHS).toHaveLength(15);
    expect(new Set(SPONSORSHIP_FILTER_PATHS).size).toBe(15);
    expect(SPONSORSHIP_FILTER_PATHS[0]).toBe(
      '/sponsorships?status=PENDING_PAYMENT&tier=LEGEND',
    );
  });

  test('法務文書の編集と公開した版のパスを種別から作る', () => {
    expect(legalEditorPath('terms')).toBe('/legal-documents/terms');
    expect(legalRevisionPath('terms', 1)).toBe(
      '/legal-documents/terms/revisions/1',
    );
  });
});
