import type {
  ApiKeyFeature,
  ApiKeyScopes,
} from '../../../common-lib/public-api/api-key-rules.ts';

export type ApiAccess = 'read' | 'write';

export type ApiTarget = 'public' | 'own';

export const allowsAccess = (
  scopes: ApiKeyScopes,
  feature: ApiKeyFeature,
  access: ApiAccess,
): boolean => {
  const level: string = scopes[feature];
  if (access === 'write') {
    return level === 'read_write';
  }
  return level === 'read' || level === 'read_write';
};
