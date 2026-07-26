export type TabKey = 'usage' | 'sites' | 'plan' | 'settings';

/** One measurement interval as returned by the backend. */
export interface ConsumptionPoint {
  start: string | null;
  stop: string | null;
  /** Consumption in kWh for the interval. */
  electricity: number | null;
  /** Spot price in c/kWh, excluding and including VAT. */
  electricity_spot_prices: number | null;
  electricity_spot_prices_vat: number | null;
}

export interface ConsumptionData {
  gsrn: string | null;
  series: ConsumptionPoint[];
}

/** A localised string map, e.g. `{ en: "Fixed price", fi: "Kiinteä hinta" }`. */
export type LocalizedText = Record<string, string>;

/* Contracts and products are passed through from Helen unmodified — the
   backend hands them to us as raw JSON. Only the fields the UI reads are
   declared here, and all of them are optional because Helen omits them
   freely between contract domains. */

export interface DeliverySiteAddress {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

export interface Contract {
  gsrn: string;
  domain?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  delivery_site?: {
    id?: number | string | null;
    address?: DeliverySiteAddress | null;
  } | null;
}

export interface ContractsResponse {
  contracts: Contract[];
  selected_gsrn: string | null;
}

export interface ProductComponent {
  id: number | string;
  name?: string | null;
  localized_name?: LocalizedText | null;
  price: number;
  price_unit?: string | null;
  localized_price_unit?: LocalizedText | null;
  price_postfix?: LocalizedText | null;
  is_base_price?: boolean | null;
}

export interface Product {
  id: number | string;
  name?: string | null;
  localized_name?: LocalizedText | null;
  product_type?: string | null;
  product_subtypes?: string[] | null;
  product_description?: { text?: LocalizedText | null } | null;
  start_date?: string | null;
  components?: ProductComponent[] | null;
}
