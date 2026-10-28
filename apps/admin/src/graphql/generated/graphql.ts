/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AdminSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };


export const AdminSystemStatusDocument = {"__meta__":{"hash":"sha256:cfd1cd38df39a20ba4d85b44cdc75b45715595ad92ef45f03d4bc5fd3146590c"}} as unknown as DocumentNode<AdminSystemStatusQuery, AdminSystemStatusQueryVariables>;