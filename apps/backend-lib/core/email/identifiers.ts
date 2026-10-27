const EmailKindRegistry: unique symbol = Symbol.for('email.EmailKindRegistry');
const EmailSender: unique symbol = Symbol.for('email.EmailSender');
const SuppressionList: unique symbol = Symbol.for('email.SuppressionList');
const SuppressionRecorder: unique symbol = Symbol.for(
  'email.SuppressionRecorder',
);
const SuppressionMaintenance: unique symbol = Symbol.for(
  'email.SuppressionMaintenance',
);
const UserAddressDirectory: unique symbol = Symbol.for(
  'email.UserAddressDirectory',
);
const SenderInfoProvider: unique symbol = Symbol.for(
  'email.SenderInfoProvider',
);
const SendRecordStore: unique symbol = Symbol.for('email.SendRecordStore');
const AlertThrottle: unique symbol = Symbol.for('email.AlertThrottle');

export const EMAIL_TYPES = Object.freeze({
  EmailKindRegistry,
  EmailSender,
  SuppressionList,
  SuppressionRecorder,
  SuppressionMaintenance,
  UserAddressDirectory,
  SenderInfoProvider,
  SendRecordStore,
  AlertThrottle,
});
