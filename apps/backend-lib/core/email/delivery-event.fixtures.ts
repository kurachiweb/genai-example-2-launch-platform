// Cloudflareの文書「Event subscriptions」の6種の例を、ドメインを`.example`に置き換えて写したもの
const SOURCE = {
  type: 'email.sending',
  zoneId: '023e105f4ecef8ad9ca31a8372d0c353',
  domain: 'send.mail.example',
} as const;

const METADATA = {
  accountId: 'f9f79265f388666de8122cfb508d7776',
  eventSubscriptionId: '1830c4bb612e43c3af7f4cada31fbf3f',
  eventSchemaVersion: 1,
  eventTimestamp: '2026-06-01T02:48:57.132Z',
} as const;

export const SAMPLE_RECIPIENT = 'user@recipient.example';

export const SAMPLE_EVENT_TIMESTAMP = new Date(METADATA.eventTimestamp);

export const DELIVERED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.delivered',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-7e9a-7b3c-9f12-1a2b3c4d5e6f',
    messageId: '0101018f7d0c4d9a-msg-deadbeef',
    sender: 'noreply@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    subject: 'Welcome',
    terminal: true,
    delivery: {
      status: 'delivered',
      provider: 'gmail',
      deliveryTimeMs: 1234,
      smtpStatusCode: '250',
      smtpEnhancedStatusCode: '2.0.0',
      smtpResponse: '250 2.0.0 OK 1714820445 a1b2c3 - gsmtp',
    },
  },
  metadata: METADATA,
} as const;

export const DEFERRED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.deferred',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-7e9b-7714-9004-11f0b6d9a341',
    messageId: '0101018f7d0c4d9a-msg-deferred',
    sender: 'receipts@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    subject: 'Your receipt',
    terminal: false,
    delivery: {
      status: 'deferred',
      provider: 'external_smtp',
      deliveryTimeMs: 2143,
      smtpStatusCode: '451',
      smtpEnhancedStatusCode: '4.2.0',
      smtpResponse: '451 4.2.0 Temporary mailbox error',
    },
    bounce: {
      type: 'soft',
      classification: 'temporary_failure',
      reason: '451 4.2.0 Temporary mailbox error',
    },
  },
  metadata: METADATA,
} as const;

export const BOUNCED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.bounced',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6',
    messageId: '0101018f7d0c4d9a-msg-bounced',
    sender: 'receipts@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    subject: 'Your receipt',
    terminal: true,
    delivery: {
      status: 'bounced',
      provider: 'external_smtp',
      deliveryTimeMs: 2143,
      smtpStatusCode: '550',
      smtpEnhancedStatusCode: '5.1.1',
      smtpResponse: '550 5.1.1 User unknown',
    },
    bounce: {
      type: 'hard',
      classification: 'permanent_failure',
      reason: '550 5.1.1 User unknown',
    },
  },
  metadata: METADATA,
} as const;

export const FAILED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.failed',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-81c1-7bc6-9344-829cd9001a12',
    messageId: '0101018f7d0c4d9a-msg-failed',
    sender: 'noreply@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    subject: 'Welcome',
    terminal: true,
    delivery: {
      status: 'failed',
    },
    failure: {
      reason: 'delivery_failed',
    },
  },
  metadata: METADATA,
} as const;

export const REJECTED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.rejected',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-830a-77e5-8fa0-8d10f4e8dc8b',
    messageId: '0101018f7d0c4d9a-msg-rejected',
    sender: 'noreply@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    subject: 'Welcome',
    terminal: true,
    delivery: {
      status: 'rejected',
    },
    rejection: {
      reason: 'suppressed',
      party: 'recipient',
      detail: 'Recipient is suppressed',
    },
  },
  metadata: METADATA,
} as const;

export const COMPLAINED_EVENT_SAMPLE = {
  type: 'cf.email.sending.message.complained',
  source: SOURCE,
  payload: {
    eventId: '0190d0c4-9f01-7c44-b2a1-aabbccddeeff',
    messageId: '0101018f7d0c4d9a-msg-complained',
    sender: 'news@send.mail.example',
    recipient: SAMPLE_RECIPIENT,
    terminal: true,
    delivery: {
      status: 'complained',
    },
    complaint: {
      type: 'abuse',
    },
  },
  metadata: METADATA,
} as const;
