/**
 * The shopping bag lives in the browser until checkout: no account needed to
 * fill it. Each line keeps a snapshot (name, image, price) so the bag renders
 * instantly; prices and stock are always checked again with the API
 * (`/bag/quote/`) before paying.
 */

export interface BagItem {
  variant: number;
  quantity: number;
  slug: string;
  name: string;
  colour: string;
  size: string;
  image: string;
  price: string;
}

const KEY = "wardrobe.bag";
const MAX_QUANTITY = 10;

export function readBag(): BagItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function save(items: BagItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage blocked: the bag lasts as long as the page
  }
  window.dispatchEvent(new CustomEvent("bag-change", { detail: items }));
}

export function bagCount(items = readBag()): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

export function addToBag(item: Omit<BagItem, "quantity">, quantity = 1): BagItem[] {
  const items = readBag();
  const existing = items.find((i) => i.variant === item.variant);
  if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
  else items.unshift({ ...item, quantity });
  save(items);
  return items;
}

export function setQuantity(variant: number, quantity: number): BagItem[] {
  const items = readBag()
    .map((i) => (i.variant === variant ? { ...i, quantity: Math.min(MAX_QUANTITY, quantity) } : i))
    .filter((i) => i.quantity > 0);
  save(items);
  return items;
}

export function removeFromBag(variant: number): BagItem[] {
  return setQuantity(variant, 0);
}

export function clearBag() {
  save([]);
}

export function bagLines(items = readBag()) {
  return items.map(({ variant, quantity }) => ({ variant, quantity }));
}
