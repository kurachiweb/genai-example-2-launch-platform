import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';
import type {
  PublicRuntimeConfig,
  ServiceFetcher,
} from '../env/frontend-env.ts';
import type { RelayContext } from '../relay/relay-headers.ts';
import type { SessionCookieName } from '../relay/session-cookie.ts';

export interface FrontendRequestContext {
  readonly nonce: string;
  readonly correlationId: string;
  readonly display: DisplayPreferences;
  readonly publicConfig: PublicRuntimeConfig;
  readonly relay: RelayContext;
  readonly api: ServiceFetcher;
  readonly sessionCookieName: SessionCookieName;
}
