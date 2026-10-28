/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ClientSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };


export const ClientSystemStatusDocument = {"__meta__":{"hash":"sha256:090cc17cd5d52bd28071adebddfe430cda6b85b3a1d2cfa05b655fc784d4ca9e"}} as unknown as DocumentNode<ClientSystemStatusQuery, ClientSystemStatusQueryVariables>;