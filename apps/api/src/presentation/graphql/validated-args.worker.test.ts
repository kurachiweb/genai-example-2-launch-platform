import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { graphql, type GraphQLResolveInfo } from 'graphql';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import { createSessionAccess } from '../gateway/session-access.ts';
import type { Resolver } from './generated/resolvers-types.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
} from './graphql-context.ts';
import { composeGatewaySchema } from './schema-composer.ts';
import { defineSchemaModule } from './schema-module.ts';
import { withValidatedArgs } from './validated-args.ts';

interface GreetingArgs {
  readonly name: string;
  readonly tags?: readonly string[] | null;
}

interface CallRecord {
  readonly parent: unknown;
  readonly args: unknown;
  readonly context: GraphQLContext;
  readonly info: GraphQLResolveInfo;
}

const CORRELATION_ID = 'correlation-validated-args';
const VALIDATION_MESSAGE = '入力内容を確認してください。';

const greetingArgs = z.object({
  name: z.string().trim().min(1).max(10),
  tags: z.array(z.string().max(3)).nullish(),
});

const nestedArgs = z.object({
  input: z.object({
    title: z.string().min(1),
    links: z.array(z.object({ url: z.url() })),
  }),
});

function createContext(): GraphQLContext {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      },
    },
    [],
  );
  return createGraphQLContext({
    access: { caller: 'client' },
    container,
    correlationId: CORRELATION_ID,
    clientIp: undefined,
    session: createSessionAccess({
      container,
      caller: 'client',
      token: undefined,
    }),
    botToken: undefined,
  });
}

function createInfo(): GraphQLResolveInfo {
  return { fieldName: 'greeting' } as unknown as GraphQLResolveInfo;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

describe('withValidatedArgs', () => {
  test('検証に成功すると変換後の引数で呼び、親・文脈・情報をそのまま渡して結果を返す', async () => {
    const calls: CallRecord[] = [];
    const resolver = withValidatedArgs(
      greetingArgs,
      (parent: { readonly id: string }, args, context, info) => {
        calls.push({ parent, args, context, info });
        return `こんにちは、${args.name}さん`;
      },
    );
    const parent = { id: 'parent-1' };
    const context = createContext();
    const info = createInfo();

    const result = await resolver(
      parent,
      { name: '  太郎  ', tags: ['a'] },
      context,
      info,
    );

    expect(result).toBe('こんにちは、太郎さん');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.parent).toBe(parent);
    expect(calls[0]?.args).toEqual({ name: '太郎', tags: ['a'] });
    expect(calls[0]?.context).toBe(context);
    expect(calls[0]?.info).toBe(info);
  });

  test('非同期のリゾルバの結果を返す', async () => {
    const resolver = withValidatedArgs(greetingArgs, (_parent: unknown, args) =>
      Promise.resolve(args.name.length),
    );

    await expect(
      resolver(undefined, { name: '花子' }, createContext(), createInfo()),
    ).resolves.toBe(2);
  });

  test('検証に失敗するとリゾルバを呼ばず、入力不正のコードと項目ごとの詳細を投げる', async () => {
    let called = false;
    const resolver = withValidatedArgs(greetingArgs, () => {
      called = true;
      return 'unreachable';
    });

    const error = await captureRejection(
      resolver(
        undefined,
        { name: '', tags: ['ok', 'toolong'] },
        createContext(),
        createInfo(),
      ),
    );

    expect(called).toBe(false);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
      message: VALIDATION_MESSAGE,
    });
    const details = (error as AppError).details ?? [];
    expect(details).toMatchObject([
      { field: 'name', code: 'too_small' },
      { field: 'tags.1', code: 'too_big' },
    ]);
    expect(details.every(({ message }) => message !== '')).toBe(true);
  });

  test('入れ子の引数の詳細の項目名は、引数のパスを.で連結した値になる', async () => {
    const resolver = withValidatedArgs(nestedArgs, () => true);

    const error = await captureRejection(
      resolver(
        undefined,
        { input: { title: 'ok', links: [{ url: 'not-a-url' }] } },
        createContext(),
        createInfo(),
      ),
    );

    expect((error as AppError).details).toMatchObject([
      { field: 'input.links.0.url', code: 'invalid_format' },
    ]);
  });

  test('検証規則に指定した文言を詳細の文言にする', async () => {
    const resolver = withValidatedArgs(
      z.object({ title: z.string().max(3, '3文字以内で入力してください。') }),
      () => true,
    );

    const error = await captureRejection(
      resolver(undefined, { title: 'abcd' }, createContext(), createInfo()),
    );

    expect((error as AppError).details).toEqual([
      {
        field: 'title',
        code: 'too_big',
        message: '3文字以内で入力してください。',
      },
    ]);
  });

  test('非同期の検証規則も検証する', async () => {
    const resolver = withValidatedArgs(
      z.object({
        slug: z.string().refine((value) => Promise.resolve(value !== 'taken'), {
          message: '使用済みです。',
        }),
      }),
      () => true,
    );

    const error = await captureRejection(
      resolver(undefined, { slug: 'taken' }, createContext(), createInfo()),
    );

    expect(error).toMatchObject({ code: 'validation_error' });
    expect((error as AppError).details).toEqual([
      { field: 'slug', code: 'custom', message: '使用済みです。' },
    ]);
  });

  test('引数全体に対する検証の失敗は、項目名を空文字列にする', async () => {
    const resolver = withValidatedArgs(
      z
        .object({ from: z.number(), to: z.number() })
        .refine((value) => value.from <= value.to, {
          message: '範囲が逆です。',
        }),
      () => true,
    );

    const error = await captureRejection(
      resolver(undefined, { from: 2, to: 1 }, createContext(), createInfo()),
    );

    expect((error as AppError).details).toEqual([
      { field: '', code: 'custom', message: '範囲が逆です。' },
    ]);
  });

  test('包んだリゾルバを生成したリゾルバの型に代入できる', async () => {
    const resolver: Resolver<
      string,
      Record<PropertyKey, never>,
      GraphQLContext,
      GreetingArgs
    > = withValidatedArgs(greetingArgs, (_parent: unknown, args) => args.name);

    const result =
      typeof resolver === 'function'
        ? await resolver({}, { name: '次郎' }, createContext(), createInfo())
        : undefined;

    expect(result).toBe('次郎');
  });

  test('スキーマのリゾルバとして実行すると、検証の失敗が入力不正のエラーになる', async () => {
    const schema = composeGatewaySchema([
      defineSchemaModule({
        name: 'validated-args-test',
        typeDefs: /* GraphQL */ `
          type Query {
            greeting(name: String!, tags: [String!]): String!
          }
        `,
        resolvers: {
          Query: {
            greeting: withValidatedArgs(
              greetingArgs,
              (_parent: unknown, args) => `こんにちは、${args.name}さん`,
            ),
          },
        },
      }),
    ]);
    const contextValue = createContext();

    const succeeded = await graphql({
      schema,
      source: '{ greeting(name: " 三郎 ") }',
      contextValue,
    });
    const failed = await graphql({
      schema,
      source: '{ greeting(name: "", tags: ["ok", "toolong"]) }',
      contextValue,
    });

    expect(succeeded).toEqual({ data: { greeting: 'こんにちは、三郎さん' } });
    expect(failed.data).toBeNull();
    expect(failed.errors?.[0]?.originalError).toBeInstanceOf(AppError);
    expect(failed.errors?.[0]?.originalError).toMatchObject({
      code: 'validation_error',
      details: [
        { field: 'name', code: 'too_small' },
        { field: 'tags.1', code: 'too_big' },
      ],
    });
  });
});
