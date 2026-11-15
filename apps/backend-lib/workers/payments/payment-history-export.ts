import type {
  PaymentHistoryExport,
  PaymentHistoryExportItem,
  PaymentRecordStore,
} from '../../core/payments/ports.ts';

export interface StoredPaymentHistoryExportDependencies {
  readonly records: PaymentRecordStore;
}

export class StoredPaymentHistoryExport implements PaymentHistoryExport {
  private readonly records: PaymentRecordStore;

  constructor(dependencies: StoredPaymentHistoryExportDependencies) {
    this.records = dependencies.records;
  }

  // 同意の日時と版・Linkの資金源のグループ・購入IDはpayments.jsonの項目ではないため含めない
  async listAll(
    pseudonymousId: string,
  ): Promise<readonly PaymentHistoryExportItem[]> {
    const rows = await this.records.listAllByPseudonymousId(pseudonymousId);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      purpose: row.purpose,
      amount: row.amount,
      currency: row.currency,
      quantity: row.quantity,
      status: row.status,
      stripeReference: row.stripeReference,
      relatedId: row.relatedId,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }
}
