import type { ResolutionContext, ServiceIdentifier } from 'inversify';

export const resolverOf =
  (context: ResolutionContext) =>
  <T>(identifier: ServiceIdentifier<T>): T =>
    context.get(identifier);
