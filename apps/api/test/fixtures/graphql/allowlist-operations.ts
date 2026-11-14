export const ALLOWLIST_TYPE_DEFS = /* GraphQL */ `
  type Query {
    clientValue: String
    adminValue: String
  }
`;

export const CLIENT_OPERATION = Object.freeze({
  documentId:
    'sha256:4816c43da17b44d5d6b343d6827d091e5f937690d59998beb3f58cf60a1e63dd',
  body: 'query ClientValue { clientValue }',
});

export const ADMIN_OPERATION = Object.freeze({
  documentId:
    'sha256:50be504394d59b79d7ed0f17a442f9d5806429e42d0c07323ea0fe2be9ad46bd',
  body: 'query AdminValue { adminValue }',
});

export const UNREGISTERED_DOCUMENT_ID = `sha256:${'0'.repeat(64)}`;
