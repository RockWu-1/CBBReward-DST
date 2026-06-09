export type BigcommerceOrder = {
  id: number;
  customer_id: number | null;
  date_created: string;
  status: string;
  total_inc_tax: string;
  total_ex_tax?: string;
};

export type BigcommerceOrderProduct = {
  id: number;
  order_id: number;
  brand?: string | null;
  quantity?: number | string;
  total_ex_tax?: string;
  price_ex_tax?: string;
  base_price?: string;
};
