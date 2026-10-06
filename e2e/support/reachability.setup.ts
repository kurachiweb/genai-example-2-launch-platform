import { test as setup } from '@playwright/test';

import { assertE2ETargetReachable } from './reachability.ts';

setup('E2E対象に到達できる', async ({ baseURL }) => {
  await assertE2ETargetReachable(baseURL);
});
