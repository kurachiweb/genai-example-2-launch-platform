import type { Hono } from 'hono';
import type { ContainerModule } from 'inversify';

// Honoは環境の型引数について不変で、Hono<PlatformHonoEnv<E>>は既定のHonoを満たさないため、制約は型引数を問わない形にする
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppModule<THono extends Hono<any, any, any> = Hono> {
  readonly name: string;
  readonly bindings?: ContainerModule;
  readonly routes?: (app: THono) => void;
}
