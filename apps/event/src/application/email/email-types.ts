const EmailProvider: unique symbol = Symbol.for('email.EmailProvider');
const EmailRenderer: unique symbol = Symbol.for('email.EmailRenderer');
const EmailIncidentReporter: unique symbol = Symbol.for(
  'email.EmailIncidentReporter',
);
const EmailRuntimeConfig: unique symbol = Symbol.for(
  'email.EmailRuntimeConfig',
);
const SendEmailHandler: unique symbol = Symbol.for('email.SendEmailHandler');
const DeliveryEventHandler: unique symbol = Symbol.for(
  'email.DeliveryEventHandler',
);

export const EVENT_EMAIL_TYPES = Object.freeze({
  EmailProvider,
  EmailRenderer,
  EmailIncidentReporter,
  EmailRuntimeConfig,
  SendEmailHandler,
  DeliveryEventHandler,
});
