export { RateLimitCounter } from '../lib/workers/rate-limit/rate-limit-counter.ts';

export default {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
