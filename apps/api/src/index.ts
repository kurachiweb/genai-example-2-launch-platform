import { apiHandler, publicEntrypoint } from './composition/api-worker.ts';
import { createGatewayEntrypointClass } from './presentation/gateway/gateway-entrypoint.ts';

export { LoginAttemptThrottle } from './infrastructure/auth/login-attempt-throttle.ts';
export { RateLimitCounter } from '../lib/workers/rate-limit/rate-limit-counter.ts';

export class ClientGateway extends createGatewayEntrypointClass(
  'client',
  apiHandler,
) {}

export class AdminGateway extends createGatewayEntrypointClass(
  'admin',
  apiHandler,
) {}

export default publicEntrypoint;
