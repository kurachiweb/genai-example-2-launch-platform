const LegalDocumentStore: unique symbol = Symbol.for(
  'legal.LegalDocumentStore',
);

const LegalDocumentReader: unique symbol = Symbol.for(
  'legal.LegalDocumentReader',
);

const LegalDocumentAdminReader: unique symbol = Symbol.for(
  'legal.LegalDocumentAdminReader',
);

const LegalDraftEditor: unique symbol = Symbol.for('legal.LegalDraftEditor');

const LegalDocumentPublisher: unique symbol = Symbol.for(
  'legal.LegalDocumentPublisher',
);

const LegalVersionLocator: unique symbol = Symbol.for(
  'legal.LegalVersionLocator',
);

export const LEGAL_TYPES = Object.freeze({
  LegalDocumentStore,
  LegalDocumentReader,
  LegalDocumentAdminReader,
  LegalDraftEditor,
  LegalDocumentPublisher,
  LegalVersionLocator,
});
