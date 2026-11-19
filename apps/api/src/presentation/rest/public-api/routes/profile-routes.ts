import type { Container } from 'inversify';

import type { MyProfileReader } from '../../../../application/profile/my-profile-reader.ts';
import { PROFILE_TYPES } from '../../../../application/profile/profile-types.ts';
import type { PublicProfileReader } from '../../../../application/profile/public-profile-reader.ts';
import type { PublicProfileUpdater } from '../../../../application/public-api/public-profile-updater.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import { ANONYMOUS_SESSION_VIEW } from '../../../../application/public-api/session-views.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import { dataEnvelope, errorResponses } from '../../responses.ts';
import { publicApiOriginsOf } from '../mappers/common-mappers.ts';
import {
  mediaRequestOfAvatar,
  toMyProfile,
  toProfilePatch,
  toPublicProfile,
} from '../mappers/profile-mappers.ts';
import type { MediaLookup } from '../media-lookup.ts';
import { redirectToCurrentHandle } from '../product-resolution.ts';
import { publicApiError } from '../public-api-errors.ts';
import { definePublicApiRoute } from '../route-definition.ts';
import { UserHandleParamsSchema } from '../schemas/common.ts';
import {
  MyProfilePatchSchema,
  MyProfileSchema,
  PublicProfileSchema,
} from '../schemas/profiles.ts';

const getPublicProfileRoute = definePublicApiRoute({
  method: 'get',
  path: '/users/{handle}',
  summary: '利用者の公開プロフィール',
  description:
    '公開プロフィールのページと同じ項目と公開範囲で、利用者の公開プロフィールを返す。キーの持ち主自身のハンドルも、ログインしていない閲覧者と同じ形で返す。存在しない・退会済み・停止中の利用者は区別せずに404(user_not_found)を返す。',
  feature: 'profile',
  access: 'read',
  target: 'public',
  request: { params: UserHandleParamsSchema },
  responses: {
    200: {
      description: '公開プロフィール',
      content: {
        'application/json': { schema: dataEnvelope(PublicProfileSchema) },
      },
    },
    302: {
      description:
        '保持中の旧ハンドルの指定。Locationは現在のハンドルに置き換えた同じ経路(クエリを保つ)',
    },
    ...errorResponses([404]),
  },
});

const getMyProfileRoute = definePublicApiRoute({
  method: 'get',
  path: '/me/profile',
  summary: '自分のプロフィール',
  description:
    'APIキーの持ち主のプロフィールを返す。停止中の利用者のキーは403(account_unavailable)になる。',
  feature: 'profile',
  access: 'read',
  target: 'own',
  responses: {
    200: {
      description: '自分のプロフィール',
      content: {
        'application/json': { schema: dataEnvelope(MyProfileSchema) },
      },
    },
  },
});

const updateMyProfileRoute = definePublicApiRoute({
  method: 'patch',
  path: '/me/profile',
  summary: '自分のプロフィールの部分更新',
  description:
    'APIキーの持ち主のプロフィールのうち、指定した項目だけをプロフィールの設定画面と同じ規則で検証して更新し、更新後のプロフィールを返す。指定しない項目とプロフィール画像は現在の値を保つ。プロフィール画像は変更できない。項目の違反は400(validation_error)、予約語・使用中のハンドルは409(handle_unavailable)、更新の途中で別の操作によりハンドルが変わった場合は409(profile_update_conflict)、停止中の利用者のキーは403(account_unavailable)になる。',
  feature: 'profile',
  access: 'write',
  target: 'own',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: MyProfilePatchSchema } },
    },
  },
  responses: {
    200: {
      description: '更新後の自分のプロフィール',
      content: {
        'application/json': { schema: dataEnvelope(MyProfileSchema) },
      },
    },
    ...errorResponses([400, 409, 415]),
  },
});

const mediaLookupOf = (container: Container): MediaLookup =>
  container.get<MediaLookup>(PUBLIC_API_TYPES.MediaLookup);

async function avatarFilesOf(
  container: Container,
  avatarFileId: string | null,
) {
  const loaded = await mediaLookupOf(container).load(
    mediaRequestOfAvatar(avatarFileId),
  );
  return loaded.files;
}

export const publicApiProfileRoutes: PublicRestRoutes<Env> = (api) => {
  // 公開APIはキーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で読む
  api.openapi(getPublicProfileRoute, async (c) => {
    const container = c.get('container');
    const result = await container
      .get<PublicProfileReader>(PROFILE_TYPES.PublicProfileReader)
      .find(ANONYMOUS_SESSION_VIEW, c.req.valid('param').handle);
    switch (result.kind) {
      case 'redirect': {
        return redirectToCurrentHandle(c, result.handle);
      }
      case 'not-found': {
        throw publicApiError('user_not_found');
      }
      case 'profile': {
        const files = await avatarFilesOf(
          container,
          result.profile.avatarFileId,
        );
        return c.json(
          {
            data: toPublicProfile(
              result.profile,
              files,
              publicApiOriginsOf(c.env),
            ),
          },
          200,
        );
      }
    }
  });

  api.openapi(getMyProfileRoute, async (c) => {
    const container = c.get('container');
    const profile = await container
      .get<MyProfileReader>(PROFILE_TYPES.MyProfileReader)
      .read(c.get('publicApiCaller').user);
    const files = await avatarFilesOf(container, profile.avatarFileId);
    return c.json(
      { data: toMyProfile(profile, files, publicApiOriginsOf(c.env)) },
      200,
    );
  });

  api.openapi(updateMyProfileRoute, async (c) => {
    const container = c.get('container');
    const profile = await container
      .get<PublicProfileUpdater>(PUBLIC_API_TYPES.PublicProfileUpdater)
      .update(
        c.get('publicApiCaller').user,
        toProfilePatch(c.req.valid('json')),
      );
    const files = await avatarFilesOf(container, profile.avatarFileId);
    return c.json(
      { data: toMyProfile(profile, files, publicApiOriginsOf(c.env)) },
      200,
    );
  });
};
