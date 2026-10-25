export type ClientIpResolver = (request: Request) => string | undefined;

const CONNECTING_IP_HEADER = 'CF-Connecting-IP';

export const resolveConnectingIp: ClientIpResolver = (request) => {
  const ip = request.headers.get(CONNECTING_IP_HEADER)?.trim();
  return ip === undefined || ip === '' ? undefined : ip;
};
