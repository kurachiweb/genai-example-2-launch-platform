import { test as base } from '@playwright/test';

import { assumeDistinctClientIp } from '../support/client-ip.ts';

export { expect } from '@playwright/test';

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    await assumeDistinctClientIp(context, baseURL);
    await use(context);
  },
});
