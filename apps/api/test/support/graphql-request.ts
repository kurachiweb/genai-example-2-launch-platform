export const API_ORIGIN = 'https://api.launch.example';

export const GRAPHQL_URL = `${API_ORIGIN}/graphql`;

export interface GraphQLRequestOptions {
  readonly headers?: Record<string, string>;
}

export function graphqlRequest(
  documentId: string,
  variables?: Record<string, unknown>,
  options: GraphQLRequestOptions = {},
): Request {
  return new Request(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(
      variables === undefined ? { documentId } : { documentId, variables },
    ),
  });
}
