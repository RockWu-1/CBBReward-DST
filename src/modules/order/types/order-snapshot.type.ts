import Decimal from 'decimal.js';

export type OrderSnapshot = {
  userId: string;
  totalAmount: Decimal;
};
