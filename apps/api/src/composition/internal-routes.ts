import type { InternalRoutes } from '../presentation/gateway/internal-only.ts';
import { registerFileContentRoutes } from '../presentation/media/file-content-route.ts';
import { registerUploadRoutes } from '../presentation/media/upload-route.ts';

export const INTERNAL_ROUTES: readonly InternalRoutes<Env>[] = [
  registerUploadRoutes,
  registerFileContentRoutes,
];
