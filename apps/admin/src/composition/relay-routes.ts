import {
  GRAPHQL_RELAY_ROUTE,
  type RelayRoute,
} from '../../lib/server/relay/relay-route.ts';

// 経路はdefineRelayRouteで定義して加える。先に一致した経路が使われるため、末尾が/*の経路は完全一致の経路より後に置く
export const RELAY_ROUTES: readonly RelayRoute[] = Object.freeze([
  GRAPHQL_RELAY_ROUTE,
]);
