const Env: unique symbol = Symbol.for('platform.Env');
const InvocationScope: unique symbol = Symbol.for('platform.InvocationScope');
const Database: unique symbol = Symbol.for('platform.Database');
const Clock: unique symbol = Symbol.for('platform.Clock');
const IdGenerator: unique symbol = Symbol.for('platform.IdGenerator');
const KeyedHasher: unique symbol = Symbol.for('platform.KeyedHasher');
const MessagePublisher: unique symbol = Symbol.for('platform.MessagePublisher');
const BotVerifier: unique symbol = Symbol.for('platform.BotVerifier');
const RateLimitCounterClient: unique symbol = Symbol.for(
  'platform.RateLimitCounterClient',
);

export const PLATFORM_TYPES = Object.freeze({
  Env,
  InvocationScope,
  Database,
  Clock,
  IdGenerator,
  KeyedHasher,
  MessagePublisher,
  BotVerifier,
  RateLimitCounterClient,
});

export interface InvocationScopeInfo {
  readonly kind: 'fetch' | 'scheduled' | 'queue';
  readonly correlationId: string;
  readonly clientIp: string | undefined;
}
