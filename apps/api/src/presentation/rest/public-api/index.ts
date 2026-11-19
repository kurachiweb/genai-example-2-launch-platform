import type { PublicRestRoutes } from '../public-api-app.ts';
import { publicApiIpRateLimitRoutes } from './ip-rate-limit.ts';

// IP単位の制限は先頭の登録で掛けたときだけ基準パスの全ての要求に掛かるため、他の経路より前に置く
export const PUBLIC_API_REST_ROUTES: readonly PublicRestRoutes<Env>[] = [
  publicApiIpRateLimitRoutes,
];
