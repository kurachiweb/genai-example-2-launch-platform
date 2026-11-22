export interface ReportErasureStore {
  eraseByReporter(
    userId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  detachCasesByOwner(
    userId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  detachCasesByProduct(
    productId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  eraseGuestReportsClosedBefore(
    threshold: Date,
    limit: number,
  ): Promise<number>;
  eraseDetachedCasesBefore(threshold: Date, limit: number): Promise<number>;
  eraseEmptyCases(limit: number): Promise<number>;
}
