export interface ExportFileView {
  readonly fileId: string;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly quarantined: boolean;
}

export interface ExportProductRef {
  readonly name: string;
  readonly handle: string;
}

export interface ExportProduct {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly categoryName: string;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  readonly logoFileId: string;
  readonly screenshotFileIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly hiddenByAdmin: boolean;
}

export interface ExportMatch {
  readonly id: string;
  readonly kind: 'qualifier' | 'week' | 'year';
  readonly round: number | null;
  readonly date: string;
  readonly upvoteCount: number;
  readonly opponentUpvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly result: 'won' | 'lost' | 'bye' | 'walkover' | null;
}

export interface ExportAward {
  readonly kind: 'product_of_the_week' | 'product_of_the_year';
  readonly period: string;
}

export interface ExportLaunch {
  readonly id: string;
  readonly productId: string;
  readonly launchDate: string;
  readonly status:
    'scheduled' | 'paired' | 'in_progress' | 'finished' | 'canceled';
  readonly matches: readonly ExportMatch[];
  readonly awards: readonly ExportAward[];
}

export interface ExportComment {
  readonly id: string;
  readonly launchId: string;
  readonly product: ExportProductRef | null;
  readonly parentCommentId: string | null;
  readonly bodyMarkdown: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly hiddenByAdmin: boolean;
}

export interface ExportUpvote {
  readonly matchId: string;
  readonly matchKind: 'qualifier' | 'week' | 'year';
  readonly matchDate: string;
  readonly product: ExportProductRef | null;
  readonly upvotedAt: Date;
}

export interface ExportRating {
  readonly product: ExportProductRef | null;
  readonly score: number;
  readonly invalidatedByAdmin: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExportFollow {
  readonly handle: string;
  readonly nickname: string;
  readonly followedAt: Date;
}

export interface ExportReport {
  readonly id: string;
  readonly targetType: 'user' | 'product' | 'comment';
  readonly targetRef: string | null;
  readonly category: string;
  readonly reason: string;
  readonly createdAt: Date;
}

export interface ExportInquiryAttachment {
  readonly fileId: string;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly size: number;
}

export interface ExportInquiryMessage {
  readonly id: string;
  readonly sender: 'user' | 'admin';
  readonly adminNickname: string | null;
  readonly body: string;
  readonly attachments: readonly ExportInquiryAttachment[];
  readonly createdAt: Date;
}

export interface ExportInquiry {
  readonly id: string;
  readonly category: string;
  readonly status: 'open' | 'in_progress' | 'resolved' | 'rejected';
  readonly createdAt: Date;
  readonly messages: readonly ExportInquiryMessage[];
}

export interface ExportSponsorship {
  readonly id: string;
  readonly product: ExportProductRef;
  readonly tier: 'silver' | 'gold' | 'legend';
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly status:
    'pending_payment' | 'scheduled' | 'active' | 'ended' | 'terminated';
  readonly paymentId: string | null;
  readonly createdAt: Date;
}

export interface ExportPayment {
  readonly id: string;
  readonly kind: 'one_time' | 'subscription' | 'refund' | 'dispute';
  readonly purpose:
    | 'week_tournament_entry'
    | 'year_tournament_entry'
    | 'sponsorship'
    | 'ultras';
  readonly amount: number;
  readonly currency: 'usd';
  readonly quantity: number | null;
  readonly status:
    | 'succeeded'
    | 'failed'
    | 'pending'
    | 'disputed'
    | 'dispute_won'
    | 'dispute_lost';
  readonly stripeReference: string;
  readonly relatedId: string | null;
  readonly occurredAt: Date;
}

export interface ExportAccount {
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly registeredAt: Date;
  readonly mfaEnabled: boolean;
  readonly plan: {
    readonly status: string;
    readonly startedAt: Date;
    readonly currentPeriodEndsAt: Date | null;
    readonly canceledAt: Date | null;
  } | null;
  readonly notificationSettings: {
    readonly matchPreview: boolean;
    readonly matchResult: boolean;
    readonly followedUserMatch: boolean;
    readonly followedUserAward: boolean;
    readonly suppressedReason: string | null;
  } | null;
  readonly apiKeys: readonly {
    readonly name: string;
    readonly scopes: Readonly<Record<string, string>>;
    readonly createdAt: Date;
  }[];
}

export interface ExportProfile {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly {
    readonly name: string;
    readonly url: string;
  }[];
  readonly updatedAt: Date;
}

export interface ExportSnapshot {
  readonly requestedAt: Date;
  readonly account: ExportAccount;
  readonly profile: ExportProfile;
  readonly products: readonly ExportProduct[];
  readonly launches: readonly ExportLaunch[];
  readonly comments: readonly ExportComment[];
  readonly upvotes: readonly ExportUpvote[];
  readonly ratings: readonly ExportRating[];
  readonly follows: readonly ExportFollow[];
  readonly reports: readonly ExportReport[];
  readonly inquiries: readonly ExportInquiry[];
  readonly sponsorships: readonly ExportSponsorship[];
  readonly payments: readonly ExportPayment[];
  readonly files: ReadonlyMap<string, ExportFileView>;
}
