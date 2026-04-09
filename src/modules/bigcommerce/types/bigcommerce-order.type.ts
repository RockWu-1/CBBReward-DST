export type BigcommerceOrder = {
  id: number;
  customer_id: number | null;
  date_created: string;
  status: string;
  total_inc_tax: string;
  total_ex_tax?: string;
};
