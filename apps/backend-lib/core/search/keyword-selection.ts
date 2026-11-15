import { normalizeIndexText } from '../../../common-lib/search/index-text.ts';

export interface KeywordEntity {
  readonly name: string;
  readonly type: string;
}

// 検索語として使われにくく、電話番号と住所は個人に関する情報になり得るため除く
export const EXCLUDED_ENTITY_TYPES = [
  'PHONE_NUMBER',
  'ADDRESS',
  'DATE',
  'NUMBER',
  'PRICE',
] as const;

export const MAX_KEYWORDS = 500;

const KEYWORD_SEPARATOR = ' ';

const excludedEntityTypes: ReadonlySet<string> = new Set(EXCLUDED_ENTITY_TYPES);

export function selectKeywords(entities: readonly KeywordEntity[]): string {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const { name, type } of entities) {
    if (keywords.length >= MAX_KEYWORDS) {
      break;
    }
    if (excludedEntityTypes.has(type)) {
      continue;
    }
    const keyword = normalizeIndexText(name);
    const key = keyword.toLowerCase();
    if (keyword === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords.join(KEYWORD_SEPARATOR);
}
