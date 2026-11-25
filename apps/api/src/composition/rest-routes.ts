import { PUBLIC_API_REST_ROUTES } from '../presentation/rest/public-api/index.ts';
import type { PublicRestRoutes } from '../presentation/rest/public-api-app.ts';

// 公開APIの集約の先頭はIP単位の制限で、後に登録する経路と仕様の配信の全てに掛かるには、この一覧の先頭に置く必要がある
export const REST_ROUTES: readonly PublicRestRoutes<Env>[] = [
  ...PUBLIC_API_REST_ROUTES,
];
