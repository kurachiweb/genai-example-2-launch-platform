import { useRouter } from '@tanstack/react-router';

import { appRuntimeOf } from '../../start/router-context.ts';

export function useImagesOrigin(): string {
  const router = useRouter();
  return appRuntimeOf(router.options.context).publicConfig.imagesOrigin;
}
