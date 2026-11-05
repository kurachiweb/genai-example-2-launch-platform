import type { Logger } from '@logtape/logtape';

import { AppError } from '../../core/errors/app-error.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type PriceCatalog,
  type PriceCatalogResult,
  type PriceSnapshot,
  type PriceSnapshotStore,
  type StripeGateway,
  type StripePrice,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface StripePriceCatalogDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly gateway: StripeGateway;
  readonly snapshots: PriceSnapshotStore;
  readonly clock: Clock;
}

const PRICE_TTL_MILLISECONDS = 10 * 60_000;

function toPrice(snapshot: PriceSnapshot): StripePrice {
  return {
    lookupKey: snapshot.lookupKey,
    priceId: snapshot.priceId,
    unitAmount: snapshot.unitAmount,
    currency: snapshot.currency,
    recurringInterval: snapshot.recurringInterval,
  };
}

function inRequestedOrder(
  lookupKeys: readonly string[],
  prices: readonly StripePrice[],
): readonly StripePrice[] {
  const byKey = new Map(prices.map((price) => [price.lookupKey, price]));
  return lookupKeys.flatMap((key) => {
    const price = byKey.get(key);
    return price === undefined ? [] : [price];
  });
}

export class StripePriceCatalog implements PriceCatalog {
  private readonly gateway: StripeGateway;
  private readonly snapshots: PriceSnapshotStore;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: StripePriceCatalogDependencies) {
    this.gateway = dependencies.gateway;
    this.snapshots = dependencies.snapshots;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([dependencies.appName, 'payments', 'prices']);
  }

  async getPrices(lookupKeys: readonly string[]): Promise<PriceCatalogResult> {
    const keys = [...new Set(lookupKeys)];
    if (keys.length === 0) {
      return { prices: [], stale: false };
    }
    const now = this.clock.now();
    const held = await this.snapshots.findMany(keys);
    const fresh = held.filter(
      ({ fetchedAt }) =>
        now.getTime() - fetchedAt.getTime() <= PRICE_TTL_MILLISECONDS,
    );
    const freshKeys = new Set(fresh.map(({ lookupKey }) => lookupKey));
    const expiredKeys = keys.filter((key) => !freshKeys.has(key));
    if (expiredKeys.length === 0) {
      return {
        prices: inRequestedOrder(keys, fresh.map(toPrice)),
        stale: false,
      };
    }
    let resolved: readonly StripePrice[];
    try {
      resolved = await this.gateway.resolvePrices(expiredKeys);
    } catch (error) {
      if (!(error instanceof StripeUnavailableError)) {
        throw error;
      }
      return this.fallBackTo(keys, held);
    }
    await this.snapshots.saveMany(resolved, now);
    return {
      prices: inRequestedOrder(keys, [...fresh.map(toPrice), ...resolved]),
      stale: false,
    };
  }

  private fallBackTo(
    keys: readonly string[],
    held: readonly PriceSnapshot[],
  ): PriceCatalogResult {
    if (held.length === 0) {
      throw new AppError({
        kind: 'unavailable',
        code: 'payments_unavailable',
        message: '現在、決済をご利用いただけません。',
      });
    }
    this.logger.warn(
      'Stripeに到達できないため、以前に照会した価格を返しました',
      { priceLookups: held.map(({ lookupKey }) => lookupKey) },
    );
    return { prices: inRequestedOrder(keys, held.map(toPrice)), stale: true };
  }
}
