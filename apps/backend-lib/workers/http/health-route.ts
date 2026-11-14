import type { Env, Hono } from 'hono';

export const HEALTH_CHECK_PATH = '/health';

const HEALTH_CHECK_BODY = Object.freeze({ status: 'ok' });

// Honoは同じ経路のGETの処理でHEADにも本文を除いて応答する
export function registerHealthRoute<E extends Env>(app: Hono<E>): void {
  app.get(HEALTH_CHECK_PATH, (c) =>
    c.json(HEALTH_CHECK_BODY, 200, { 'Cache-Control': 'no-store' }),
  );
}
