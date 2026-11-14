import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { requireData } from '../../utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
  type PersistedDocument,
} from '../../utilities/graphql/persisted-document.ts';
import { executeGraphQL } from './execute-graphql.ts';

export interface GraphQLMutationInput<TVariables> {
  readonly variables: TVariables;
  readonly turnstileToken?: string | undefined;
}

export function graphqlQueryOptions<TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
  variables: TVariables,
) {
  return queryOptions({
    queryKey: graphqlQueryKey(document, variables),
    queryFn: async ({ signal }) =>
      requireData(await executeGraphQL(document, variables, { signal })),
  });
}

export function graphqlMutationOptions<TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
) {
  return mutationOptions({
    mutationKey: [documentIdOf(document)],
    mutationFn: async ({
      variables,
      turnstileToken,
    }: GraphQLMutationInput<TVariables>) =>
      requireData(
        await executeGraphQL(document, variables, { turnstileToken }),
      ),
  });
}
