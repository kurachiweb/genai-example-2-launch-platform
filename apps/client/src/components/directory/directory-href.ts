import { defaultStringifySearch } from '@tanstack/react-router';

import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DIRECTORY_HREF } from '../layout/site-links.ts';

// ルーターが遷移の時に作るURLと同じ表記にするため、ルーターの既定の書き出しで条件をクエリにする
export const directoryHref = (query: DirectoryQuery): string =>
  `${DIRECTORY_HREF}${defaultStringifySearch({ ...query })}`;
