import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { HEALTH_CHECK_PATH, registerHealthRoute } from './health-route.ts';

function createApp(): Hono {
  const app = new Hono();
  registerHealthRoute(app);
  return app;
}

describe('registerHealthRoute', () => {
  test('GETに200・no-store・状態だけの本文を返す', async () => {
    const response = await createApp().request(HEALTH_CHECK_PATH);

    expect(HEALTH_CHECK_PATH).toBe('/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({ status: 'ok' });
  });

  test('HEADに本文の無い200・no-storeを返す', async () => {
    const response = await createApp().request(HEALTH_CHECK_PATH, {
      method: 'HEAD',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  test('GET・HEAD以外のメソッドは扱わない', async () => {
    const response = await createApp().request(HEALTH_CHECK_PATH, {
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });
});
