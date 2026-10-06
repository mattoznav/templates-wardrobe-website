/** Shapes returned by the wardrobe backend API. */

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Photo {
  url: string;
  photographer: string;
  photographer_url: string;
  source_url: string;
}

export interface Store {
  name: string;
  tagline: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  opening_hours: string;
  timezone: string;
  currency: string;
  free_shipping_over: string | null;
  return_window_days: number;
}

export interface Editorial {
  title: string;
  text: string;
  alt: string;
  image: Photo;
}

export interface Category {
  slug: string;
  name: string;
  position: number;
}

export interface Colour {
  slug: string;
  name: string;
  hex: string;
}

export interface Size {
  code: string;
  label: string;
  system: "letter" | "shoe" | "one";
  position: number;
}

export interface ProductImage extends Photo {
  alt: string;
  colour: string | null;
}

export interface Variant {
  id: number;
  sku: string;
  colour: string;
  size: string;
  stock: number;
}

export type Department = "women" | "men" | "unisex";

export interface Product {
  id: number;
  slug: string;
  name: string;
  department: Department;
  category: string;
  category_name: string;
  status: string;
  description: string;
  details: string[];
  composition: string;
  care: string;
  price: string;
  compare_at_price: string | null;
  on_sale: boolean;
  is_new: boolean;
  popularity: number;
  colours: Colour[];
  sizes: { code: string; label: string }[];
  in_stock: boolean;
  images: ProductImage[];
  variants: Variant[];
  collections: string[];
  created_at: string;
}

export interface Collection {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  image: Photo;
  alt: string;
  product_count: number;
}

export interface ShippingMethod {
  code: string;
  name: string;
  description: string;
  price: string;
  free_over_threshold: boolean;
  days_min: number;
  days_max: number;
}

export interface QuoteLine {
  variant: number;
  sku: string;
  product: { slug: string; name: string };
  colour: string;
  size: string;
  image: string;
  unit_price: string;
  compare_at_price: string | null;
  quantity: number;
  available: number;
  line_total: string;
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: string;
  shipping: string;
  total: string;
  currency: string;
  shipping_method: string | null;
  free_shipping_over: string | null;
  problems: string[];
}

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "expired";

export interface OrderLine {
  id: number;
  variant: number;
  product_name: string;
  product_slug: string;
  colour: string;
  size: string;
  sku: string;
  image_url: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  returnable: number;
}

export interface Order {
  id: number;
  reference: string;
  status: OrderStatus;
  status_label: string;
  email: string;
  full_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  shipping_method: ShippingMethod;
  subtotal: string;
  shipping: string;
  total: string;
  currency: string;
  lines: OrderLine[];
  expires_at: string;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  tracking_number: string;
  can_cancel: boolean;
  can_return: boolean;
  return_deadline: string | null;
  returns: { id: number; reference: string; status: string; refund_amount: string; created_at: string }[];
}

export interface ReturnRequest {
  id: number;
  reference: string;
  order: { id: number; reference: string; currency: string };
  status: "requested" | "refunded" | "rejected";
  status_label: string;
  reason: string;
  reason_label: string;
  note: string;
  lines: { order_line: number; product_name: string; colour: string; size: string; image_url: string; unit_price: string; quantity: number }[];
  value: string;
  refund_amount: string;
  staff_note: string;
  created_at: string;
  closed_at: string | null;
}

/** Showcase mode only: what the in-browser backend needs, written at build time (src/pages/showcase/). */
export interface Snapshot {
  store: Store;
  shipping: ShippingMethod[];
  colours: Record<string, string>;
  sizes: Record<string, string>;
  products: {
    slug: string;
    name: string;
    price: string;
    compare_at_price: string | null;
    /** [id, sku, colour, size, stock] */
    variants: [number, string, string, string, number][];
    /** Colour slug to photo URL; "" is the product's first photo */
    images: Record<string, string>;
  }[];
}
