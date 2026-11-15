import { z } from 'zod';

import {
  type ClientIpResolver,
  resolveConnectingIp,
} from '../../../lib/workers/rate-limit/client-ip.ts';
import {
  CALLER_KINDS,
  type CallerKind,
  GATEWAY_HEADERS,
} from './gateway-headers.ts';

const clientIpSchema = z.union([z.ipv4(), z.ipv6()]);

function withHeaders(
  request: Request,
  edit: (headers: Headers) => void,
): Request {
  const headers = new Headers(request.headers);
  edit(headers);
  return new Request(request, { headers });
}

export function markInternalRequest(
  request: Request,
  caller: CallerKind,
): Request {
  return withHeaders(request, (headers) => {
    headers.set(GATEWAY_HEADERS.caller, caller);
  });
}

export function stripGatewayHeaders(request: Request): Request {
  return withHeaders(request, (headers) => {
    headers.delete(GATEWAY_HEADERS.caller);
    headers.delete(GATEWAY_HEADERS.clientIp);
  });
}

export function readInternalCaller(request: Request): CallerKind | undefined {
  const value = request.headers.get(GATEWAY_HEADERS.caller);
  return CALLER_KINDS.find((kind) => kind === value);
}

export function parseClientIp(value: string | null): string | undefined {
  const result = clientIpSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export const resolveGatewayClientIp: ClientIpResolver = (request) =>
  readInternalCaller(request) === undefined
    ? resolveConnectingIp(request)
    : parseClientIp(request.headers.get(GATEWAY_HEADERS.clientIp));
