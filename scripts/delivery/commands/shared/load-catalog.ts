import type { RepoFiles } from '../../adapters/repo-files.ts';
import {
  type DeployEnvironment,
  type ResourceCatalog,
  parseResourceCatalog,
  resourceCatalogPath,
} from '../../catalog/resource-catalog.ts';
import {
  type Loaded,
  failed,
  loaded,
  parseInput,
  readInput,
} from './load-input.ts';

export const withPath = (
  path: string,
  errors: readonly string[],
): readonly string[] => errors.map((error) => `${path}: ${error}`);

export async function loadResourceCatalog(
  files: RepoFiles,
  env: DeployEnvironment,
): Promise<Loaded<ResourceCatalog>> {
  const path = resourceCatalogPath(env);
  const text = await readInput(files, path);
  if (!text.ok) return text;
  const json = parseInput(path, text.value, 'JSON', JSON.parse);
  if (!json.ok) return json;
  const result = parseResourceCatalog(json.value, env);
  return result.ok
    ? loaded(result.catalog)
    : failed(withPath(path, result.errors));
}
