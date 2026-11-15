import { snakeCase } from 'drizzle-orm/sqlite-core';

import { previousHandleColumns } from '../handles/previous-handle-columns.ts';
import { products } from './products.ts';

export const productPreviousHandles = snakeCase.table(
  'product_previous_handles',
  previousHandleColumns({
    ownerColumnName: 'product_id',
    references: () => products.id,
  }),
);
