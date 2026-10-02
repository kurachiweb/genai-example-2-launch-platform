import { categorySlugOf } from '#/lib/mock-data';

import type { DirectoryState } from './options';

// listedは掲載中のプロダクト数。選択肢の並び順にのみ使い、画面には表示しない
export type Category = { slug: string; name: string; listed: number };

const OTHER_SLUG = 'other';

const STANDARD: Category[] = [
  { slug: 'ai', name: 'AI', listed: 412 },
  { slug: 'developer-tools', name: '開発ツール', listed: 388 },
  { slug: 'productivity', name: '生産性', listed: 301 },
  { slug: 'marketing', name: 'マーケティング', listed: 214 },
  { slug: 'design', name: 'デザイン', listed: 187 },
  { slug: OTHER_SLUG, name: 'その他', listed: 140 },
  { slug: 'education', name: '教育', listed: 96 },
  { slug: 'healthcare', name: 'ヘルスケア', listed: 88 },
  { slug: 'finance', name: 'ファイナンス', listed: 54 },
  { slug: 'community', name: 'コミュニティ', listed: 54 },
];

// 管理者が上限なく追加できるカテゴリの例。追加直後で掲載0件のものや同数のものを含める
const EXTRA: Category[] = [
  { slug: 'security', name: 'セキュリティ', listed: 47 },
  { slug: 'analytics', name: 'データ分析', listed: 61 },
  { slug: 'no-code', name: 'ノーコード', listed: 33 },
  { slug: 'ecommerce', name: 'EC', listed: 28 },
  { slug: 'music', name: '音楽', listed: 12 },
  { slug: 'games', name: 'ゲーム', listed: 39 },
  { slug: 'travel', name: '旅行', listed: 9 },
  { slug: 'real-estate', name: '不動産', listed: 5 },
  { slug: 'hr', name: '人事・採用', listed: 22 },
  { slug: 'legal', name: '法務', listed: 7 },
  { slug: 'customer-support', name: 'カスタマーサポート', listed: 31 },
  { slug: 'sales', name: 'セールス', listed: 26 },
  { slug: 'photo-video', name: '写真・動画', listed: 18 },
  { slug: 'writing', name: 'ライティング', listed: 24 },
  { slug: 'news', name: 'ニュース', listed: 6 },
  { slug: 'weather', name: '天気', listed: 2 },
  { slug: 'sports', name: 'スポーツ', listed: 11 },
  { slug: 'fitness', name: 'フィットネス', listed: 15 },
  { slug: 'food', name: '料理・レシピ', listed: 13 },
  { slug: 'pets', name: 'ペット', listed: 4 },
  { slug: 'parenting', name: '子育て', listed: 8 },
  { slug: 'sustainability', name: 'サステナビリティ', listed: 10 },
  { slug: 'hardware', name: 'ハードウェア', listed: 14 },
  { slug: 'iot', name: 'IoT', listed: 9 },
  { slug: 'blockchain', name: 'ブロックチェーン', listed: 3 },
  { slug: 'api', name: 'API', listed: 42 },
  { slug: 'open-source', name: 'オープンソース', listed: 37 },
  { slug: 'accessibility', name: 'アクセシビリティ', listed: 16 },
  { slug: 'translation', name: '翻訳・多言語', listed: 20 },
  { slug: 'events', name: 'イベント', listed: 0 },
];

// 上限(30文字)ちょうどのカテゴリ名。長い英単語の折り返しも確認する
const LONG_NAMES: Record<string, string> = {
  'developer-tools':
    'ソフトウェア開発者体験とプラットフォームエンジニアリング支援',
  marketing: 'Hyperpersonalization&Marketing',
  community: 'クリエイターエコノミーとファンコミュニティを支える仕組み作り',
  accessibility: 'Accessibility&Inclusive-Design',
};

const collator = new Intl.Collator('ja');

// 掲載数が多い順。同数は名称順とし、システム標準の「その他」は具体的なカテゴリを埋もれさせないよう末尾に固定する
function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => {
    if (a.slug === OTHER_SLUG) return 1;
    if (b.slug === OTHER_SLUG) return -1;
    return b.listed - a.listed || collator.compare(a.name, b.name);
  });
}

export function categoryMaster(
  state: Pick<DirectoryState, 'categories' | 'text'>,
): Category[] {
  const base = state.categories === 'many' ? [...STANDARD, ...EXTRA] : STANDARD;
  const named =
    state.text === 'long'
      ? base.map((category) => ({
          ...category,
          name: LONG_NAMES[category.slug] ?? category.name,
        }))
      : base;
  return sortCategories(named);
}

export function findCategory(
  master: Category[],
  slug: string | undefined,
): Category | undefined {
  if (!slug) return undefined;
  const lower = slug.toLowerCase();
  return master.find((category) => category.slug === lower);
}

export function categoryOfProduct(
  master: Category[],
  productCategory: string,
): Category {
  const slug = categorySlugOf(productCategory);
  return (
    findCategory(master, slug) ??
    master.find((category) => category.slug === OTHER_SLUG) ??
    master[0]
  );
}
