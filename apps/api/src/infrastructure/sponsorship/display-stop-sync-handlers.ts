import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type { DisplayStopSubject } from '../../../lib/core/sponsorship/ports.ts';
import type { DisplayStopStatements } from '../../../lib/workers/sponsorship/display-stop-statements.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';

type DisplayStopTransition = 'start' | 'end';

function statementsOf(
  statements: DisplayStopStatements,
  transition: DisplayStopTransition | undefined,
  subject: DisplayStopSubject,
  at: Date,
  db: Database,
): Promise<readonly BatchItem<'sqlite'>[]> {
  switch (transition) {
    case 'start':
      return Promise.resolve([statements.startStatement(subject, at, db)]);
    case 'end':
      return Promise.resolve([statements.endStatement(subject, at, db)]);
    case undefined:
      return Promise.resolve([]);
  }
}

const PRODUCT_TRANSITIONS: Partial<
  Record<ProductLifecycleEvent['type'], DisplayStopTransition>
> = { hidden: 'start', unhidden: 'end' };

const ACCOUNT_TRANSITIONS: Partial<
  Record<UserLifecycleEvent['type'], DisplayStopTransition>
> = { suspended: 'start', unsuspended: 'end' };

@injectable()
export class ProductDisplayStopSyncHandler implements ProductLifecycleSyncHandler {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStatements)
    private readonly statements: DisplayStopStatements,
  ) {}

  statementsFor(
    event: ProductLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    return statementsOf(
      this.statements,
      PRODUCT_TRANSITIONS[event.type],
      { kind: 'product', productId: event.productId },
      event.occurredAt,
      db,
    );
  }
}

@injectable()
export class AccountDisplayStopSyncHandler implements UserLifecycleSyncHandler {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStatements)
    private readonly statements: DisplayStopStatements,
  ) {}

  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    return statementsOf(
      this.statements,
      ACCOUNT_TRANSITIONS[event.type],
      { kind: 'user', userId: event.userId },
      event.occurredAt,
      db,
    );
  }
}
