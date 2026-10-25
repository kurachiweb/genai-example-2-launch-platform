import { customType } from 'drizzle-orm/sqlite-core';

// Drizzleには列の照合順序を指定するAPIが無いため、SQL型に照合順序を含める
export const textNoCase = customType<{ data: string }>({
  dataType() {
    return 'text collate nocase';
  },
});
