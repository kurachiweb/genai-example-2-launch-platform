import type { PublicRestRoutes } from '../public-api-app.ts';
import { publicApiIpRateLimitRoutes } from './ip-rate-limit.ts';
import { publicApiEngagementRoutes } from './routes/engagement-routes.ts';
import { publicApiMyProductRoutes } from './routes/my-product-routes.ts';
import { publicApiProductRoutes } from './routes/product-routes.ts';
import { publicApiProfileRoutes } from './routes/profile-routes.ts';
import { publicApiUpvoteRoutes } from './routes/upvote-routes.ts';

// IP単位の制限は先頭の登録で掛けたときだけ基準パスの全ての要求に掛かるため、他の経路より前に置く
export const PUBLIC_API_REST_ROUTES: readonly PublicRestRoutes<Env>[] = [
  publicApiIpRateLimitRoutes,
  publicApiProductRoutes,
  publicApiUpvoteRoutes,
  publicApiEngagementRoutes,
  publicApiProfileRoutes,
  publicApiMyProductRoutes,
];
