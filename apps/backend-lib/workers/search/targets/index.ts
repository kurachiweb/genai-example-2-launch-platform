import type { SearchTargetDefinition } from '../search-target-definition.ts';
import { HELP_ARTICLE_SEARCH_TARGET } from './help-articles.ts';
import { PRODUCT_SEARCH_TARGET } from './product.ts';

export const SEARCH_TARGETS: readonly SearchTargetDefinition[] = [
  PRODUCT_SEARCH_TARGET,
  HELP_ARTICLE_SEARCH_TARGET,
];
