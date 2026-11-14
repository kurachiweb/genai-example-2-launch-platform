import { useRouter } from '@tanstack/react-router';

import { appRuntimeOf } from '../../../lib/start/router-context.ts';

// 利用者側のページは別のオリジンにあり管理画面のルーターで遷移できないため、公開設定の利用者側のオリジンを付けた絶対URLにする
export function useClientSiteHref(): (path: string) => string {
  const router = useRouter();
  const origin = appRuntimeOf(router.options.context).publicConfig
    .clientSiteOrigin;
  return (path) => `${origin}${path}`;
}
