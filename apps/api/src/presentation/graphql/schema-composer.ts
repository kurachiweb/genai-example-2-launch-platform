import {
  type DefinitionNode,
  type GraphQLSchema,
  isTypeDefinitionNode,
  isTypeExtensionNode,
  Kind,
  lexicographicSortSchema,
  parse,
  printSchema,
} from 'graphql';
import { createSchema } from 'graphql-yoga';

import { dateTimeScalar } from './date-time-scalar.ts';
import { PLATFORM_TYPE_DEFS } from './platform-type-defs.ts';
import {
  defineSchemaModule,
  type GraphQLSchemaModule,
} from './schema-module.ts';

const PLATFORM_MODULE = defineSchemaModule({
  name: 'platform',
  typeDefs: PLATFORM_TYPE_DEFS,
  resolvers: { [dateTimeScalar.name]: dateTimeScalar },
});

const ROOT_TYPE_NAMES: ReadonlySet<string> = new Set(['Query', 'Mutation']);

export class SchemaCompositionError extends Error {
  override readonly name = 'SchemaCompositionError';
  readonly conflicts: readonly string[];

  constructor(conflicts: readonly string[]) {
    super(`スキーマモジュールの定義が重複しています: ${conflicts.join(', ')}`);
    this.conflicts = Object.freeze([...conflicts]);
  }
}

interface ModuleDefinitions {
  readonly typeNames: readonly string[];
  readonly memberKeys: readonly MemberKey[];
}

interface MemberKey {
  readonly typeName: string;
  readonly key: string;
}

function memberNamesOf(definition: DefinitionNode): readonly string[] {
  switch (definition.kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_EXTENSION:
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_EXTENSION:
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return (definition.fields ?? []).map((field) => field.name.value);
    case Kind.ENUM_TYPE_DEFINITION:
    case Kind.ENUM_TYPE_EXTENSION:
      return (definition.values ?? []).map((value) => value.name.value);
    default:
      return [];
  }
}

function collectDefinitions(typeDefs: string): ModuleDefinitions {
  const typeNames: string[] = [];
  const memberKeys: MemberKey[] = [];
  for (const definition of parse(typeDefs).definitions) {
    if (!isTypeDefinitionNode(definition) && !isTypeExtensionNode(definition)) {
      continue;
    }
    const typeName = definition.name.value;
    if (isTypeDefinitionNode(definition) && !ROOT_TYPE_NAMES.has(typeName)) {
      typeNames.push(typeName);
    }
    for (const memberName of memberNamesOf(definition)) {
      memberKeys.push({ typeName, key: `${typeName}.${memberName}` });
    }
  }
  return { typeNames, memberKeys };
}

function groupOwners(
  entries: readonly (readonly [key: string, owner: string])[],
): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const [key, owner] of entries) {
    owners.set(key, [...(owners.get(key) ?? []), owner]);
  }
  return owners;
}

function duplicatedKeys(
  owners: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  return [...owners]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => `${key}(${names.join(', ')})`);
}

function findConflicts(
  modules: readonly GraphQLSchemaModule[],
): readonly string[] {
  const moduleNameConflicts = [
    ...groupOwners(modules.map(({ name }) => [name, name])),
  ]
    .filter(([, names]) => names.length > 1)
    .map(([name]) => `module:${name}`);

  const definitions = modules.map((module) => ({
    owner: module.name,
    ...collectDefinitions(module.typeDefs),
  }));
  const typeOwners = groupOwners(
    definitions.flatMap(({ owner, typeNames }) =>
      typeNames.map((typeName) => [typeName, owner] as const),
    ),
  );
  const duplicatedTypes = new Set(
    [...typeOwners].filter(([, names]) => names.length > 1).map(([key]) => key),
  );
  // 型そのものが重複した場合は型の衝突として1件だけ報告し、その項目の衝突は重ねて報告しない
  const memberOwners = groupOwners(
    definitions.flatMap(({ owner, memberKeys }) =>
      memberKeys
        .filter(({ typeName }) => !duplicatedTypes.has(typeName))
        .map(({ key }) => [key, owner] as const),
    ),
  );

  return [
    ...moduleNameConflicts,
    ...duplicatedKeys(typeOwners),
    ...duplicatedKeys(memberOwners),
  ];
}

export function composeGatewaySchema(
  modules: readonly GraphQLSchemaModule[],
): GraphQLSchema {
  const allModules = [PLATFORM_MODULE, ...modules];
  const conflicts = findConflicts(allModules);
  if (conflicts.length > 0) {
    throw new SchemaCompositionError(conflicts);
  }
  return createSchema({
    typeDefs: allModules.map(({ typeDefs }) => typeDefs),
    resolvers: allModules.map(({ resolvers }) => resolvers ?? {}),
  });
}

export function printGatewaySchema(schema: GraphQLSchema): string {
  return `${printSchema(lexicographicSortSchema(schema))}\n`;
}
