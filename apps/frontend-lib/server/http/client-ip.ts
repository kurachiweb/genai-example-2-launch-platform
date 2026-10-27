import { z } from 'zod';

const CONNECTING_IP_HEADER = 'CF-Connecting-IP';

const clientIpSchema = z.union([z.ipv4(), z.ipv6()]);

export function resolveClientIp(request: Request): string | undefined {
  const result = clientIpSchema.safeParse(
    request.headers.get(CONNECTING_IP_HEADER)?.trim(),
  );
  return result.success ? result.data : undefined;
}
