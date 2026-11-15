// Zodはスキーマを作る時点でJITの可否を判定するため、どのスキーマを持つモジュールよりも先にjitlessの設定を評価させる
import '../lib/utilities/validation/zod.ts';

import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
