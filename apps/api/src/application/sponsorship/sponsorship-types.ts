// backend-lib/core/sponsorshipの識別子がsponsorship.の接頭辞を使うため、APIサーバーの識別子はsponsorship.api.で分ける
const SponsorshipApplication: unique symbol = Symbol.for(
  'sponsorship.api.SponsorshipApplication',
);
const SponsorshipOfferReader: unique symbol = Symbol.for(
  'sponsorship.api.SponsorshipOfferReader',
);
const MySponsorshipsReader: unique symbol = Symbol.for(
  'sponsorship.api.MySponsorshipsReader',
);
const AdminSponsorshipsReader: unique symbol = Symbol.for(
  'sponsorship.api.AdminSponsorshipsReader',
);
const SponsorshipTermination: unique symbol = Symbol.for(
  'sponsorship.api.SponsorshipTermination',
);
const SponsorshipTerminationWriter: unique symbol = Symbol.for(
  'sponsorship.api.SponsorshipTerminationWriter',
);
const DailyNoticesJob: unique symbol = Symbol.for(
  'sponsorship.api.DailyNoticesJob',
);
const MaintenanceJob: unique symbol = Symbol.for(
  'sponsorship.api.MaintenanceJob',
);
const AccountWithdrawalSyncHandler: unique symbol = Symbol.for(
  'sponsorship.api.AccountWithdrawalSyncHandler',
);
const ProductDeletionSyncHandler: unique symbol = Symbol.for(
  'sponsorship.api.ProductDeletionSyncHandler',
);
const AccountDisplayStopSyncHandler: unique symbol = Symbol.for(
  'sponsorship.api.AccountDisplayStopSyncHandler',
);
const ProductDisplayStopSyncHandler: unique symbol = Symbol.for(
  'sponsorship.api.ProductDisplayStopSyncHandler',
);

export const SPONSORSHIP_TYPES = Object.freeze({
  SponsorshipApplication,
  SponsorshipOfferReader,
  MySponsorshipsReader,
  AdminSponsorshipsReader,
  SponsorshipTermination,
  SponsorshipTerminationWriter,
  DailyNoticesJob,
  MaintenanceJob,
  AccountWithdrawalSyncHandler,
  ProductDeletionSyncHandler,
  AccountDisplayStopSyncHandler,
  ProductDisplayStopSyncHandler,
});
