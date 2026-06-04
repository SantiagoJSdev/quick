export type ReportSalesFilter = {
  storeId: string;
  status: 'CONFIRMED';
  startUtc: Date;
  endUtc: Date;
  deviceId?: string;
};
