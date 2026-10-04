/**
 * Build-time data. The catalogue, collections and editorial copy are rendered
 * once from the API; stock, the bag, accounts and orders are fetched live in
 * the browser instead (see src/lib/client.ts).
 */
import type { Category, Collection, Colour, Editorial, Product, ShippingMethod, Size, Store } from "./types";

export const API_URL = (import.meta.env.PUBLIC_API_URL ?? "http://localhost:8001/api").replace(/\/$/, "");

async function get<T>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}. Is the backend running?`);
  return res.json() as Promise<T>;
}

export interface Catalog {
  store: Store;
  editorial: Record<string, Editorial>;
  products: Product[];
  categories: Category[];
  colours: Colour[];
  sizes: Size[];
  collections: Collection[];
  shipping: ShippingMethod[];
}

// Cached per build, so every page shares one round of requests. In development
// the cache lasts a few seconds, so edits made in the admin show up on reload.
let cache: Promise<Catalog> | undefined;
let cachedAt = 0;

export function catalog(): Promise<Catalog> {
  if (import.meta.env.DEV && Date.now() - cachedAt > 5000) cache = undefined;
  if (!cache) cachedAt = Date.now();
  cache ??= (async () => {
    const [store, editorial, products, categories, colours, sizes, collections, shipping] = await Promise.all([
      get<Store>("/store/"),
      get<Record<string, Editorial>>("/editorial/"),
      get<Product[]>("/products/"),
      get<Category[]>("/categories/"),
      get<Colour[]>("/colours/"),
      get<Size[]>("/sizes/"),
      get<Collection[]>("/collections/"),
      get<ShippingMethod[]>("/shipping-methods/"),
    ]);
    return { store, editorial, products, categories, colours, sizes, collections, shipping };
  })();
  return cache;
}

export const DEPARTMENTS = [
  { slug: "women", name: "Women" },
  { slug: "men", name: "Men" },
  { slug: "accessories", name: "Accessories" },
] as const;

const ACCESSORY_CATEGORIES = new Set(["bags", "shoes", "accessories", "jewellery"]);

/** "Accessories" is a shop section, not a department: it groups bags, shoes and small things. */
export function inSection(product: Product, section: string): boolean {
  if (section === "accessories") return ACCESSORY_CATEGORIES.has(product.category);
  return product.department === section || (product.department === "unisex" && !ACCESSORY_CATEGORIES.has(product.category));
}

export function sectionOf(product: Product): string {
  if (ACCESSORY_CATEGORIES.has(product.category)) return "accessories";
  return product.department === "men" ? "men" : "women";
}
