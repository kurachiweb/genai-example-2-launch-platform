const HelpArticleStore: unique symbol = Symbol.for('help.HelpArticleStore');

const HelpCategoryStore: unique symbol = Symbol.for('help.HelpCategoryStore');

const PublicHelpStore: unique symbol = Symbol.for('help.PublicHelpStore');

const HelpAuthorLookup: unique symbol = Symbol.for('help.HelpAuthorLookup');

const HelpArticleEditor: unique symbol = Symbol.for('help.HelpArticleEditor');

const HelpArticleAdminReader: unique symbol = Symbol.for(
  'help.HelpArticleAdminReader',
);

const HelpCategoryService: unique symbol = Symbol.for(
  'help.HelpCategoryService',
);

const PublicHelpReader: unique symbol = Symbol.for('help.PublicHelpReader');

export const HELP_TYPES = Object.freeze({
  HelpArticleStore,
  HelpCategoryStore,
  PublicHelpStore,
  HelpAuthorLookup,
  HelpArticleEditor,
  HelpArticleAdminReader,
  HelpCategoryService,
  PublicHelpReader,
});
