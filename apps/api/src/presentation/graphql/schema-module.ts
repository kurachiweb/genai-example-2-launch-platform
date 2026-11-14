import type { createSchema } from 'graphql-yoga';

export type SchemaResolvers = Exclude<
  NonNullable<Parameters<typeof createSchema>[0]['resolvers']>,
  readonly unknown[]
>;

export interface GraphQLSchemaModule {
  readonly name: string;
  readonly typeDefs: string;
  readonly resolvers?: SchemaResolvers;
}

export function defineSchemaModule(
  module: GraphQLSchemaModule,
): GraphQLSchemaModule {
  return module;
}
