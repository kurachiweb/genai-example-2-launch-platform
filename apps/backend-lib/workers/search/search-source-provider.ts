import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../core/search/identifiers.ts';
import type { SearchSourceProvider } from '../../core/search/ports.ts';
import type { SearchSource } from '../../core/search/search-target.ts';
import {
  requireSearchTargetDefinition,
  type SearchTargetRegistry,
} from './search-target-definition.ts';

@injectable()
export class RegistrySearchSourceProvider implements SearchSourceProvider {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SEARCH_TYPES.TargetCatalog)
    private readonly registry: SearchTargetRegistry,
  ) {}

  async read(
    target: string,
    sourceId: string,
  ): Promise<SearchSource | undefined> {
    return await requireSearchTargetDefinition(this.registry, target).read(
      this.db,
      sourceId,
    );
  }
}
