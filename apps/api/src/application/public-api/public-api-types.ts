// backend-lib/core/public-apiのPUBLIC_API_PLATFORM_TYPESも同じpublic-api.の接頭辞を使うため、メンバーの名前を重ねない
const ApiKeyStore: unique symbol = Symbol.for('public-api.ApiKeyStore');

const ApiKeySecretGenerator: unique symbol = Symbol.for(
  'public-api.ApiKeySecretGenerator',
);

const PublicApiRateLimits: unique symbol = Symbol.for(
  'public-api.PublicApiRateLimits',
);

const ApiKeyManagement: unique symbol = Symbol.for(
  'public-api.ApiKeyManagement',
);

const ApiKeyAuthorizer: unique symbol = Symbol.for(
  'public-api.ApiKeyAuthorizer',
);

const PublicSupporterReader: unique symbol = Symbol.for(
  'public-api.PublicSupporterReader',
);

const PublicProfileUpdater: unique symbol = Symbol.for(
  'public-api.PublicProfileUpdater',
);

const OwnProductDescriptionService: unique symbol = Symbol.for(
  'public-api.OwnProductDescriptionService',
);

const MediaLookup: unique symbol = Symbol.for('public-api.MediaLookup');

const ApiKeyErasureSyncHandler: unique symbol = Symbol.for(
  'public-api.ApiKeyErasureSyncHandler',
);

export const PUBLIC_API_TYPES = Object.freeze({
  ApiKeyStore,
  ApiKeySecretGenerator,
  PublicApiRateLimits,
  ApiKeyManagement,
  ApiKeyAuthorizer,
  PublicSupporterReader,
  PublicProfileUpdater,
  OwnProductDescriptionService,
  MediaLookup,
  ApiKeyErasureSyncHandler,
});
