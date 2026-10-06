/**
 * Showcase mode: the wardrobe backend, simulated in the browser.
 *
 * The static demo on GitHub Pages has no server, so `src/lib/client.ts` sends
 * its requests here instead (only when PUBLIC_SHOWCASE=true; otherwise this
 * file is never downloaded). Every endpoint the website uses answers with the
 * same shapes, status codes and error payloads as the Django API, and applies
 * the same rules as the services of the backend apps: prices and free delivery, stock
 * reserved while paying and released when the hold expires, order statuses,
 * cancellations, the return window and refunds.
 *
 * The catalogue comes from snapshots written at build time
 * (`src/pages/showcase/`). Accounts, tokens, orders, payments, returns and the
 * stock this visitor took live in localStorage under one key, so they stay in
 * this browser only. Passwords are stored as salted SHA-256 hashes.
 *
 * Nobody works in the warehouse of a static site, so its part is simulated:
 * a paid order ships a few minutes after payment and arrives a few minutes
 * later, and a requested return is received and refunded a few minutes after
 * it is sent. That keeps cancellations and returns both reachable in a visit.
 */
import { withBase } from "./paths";
import type { Product, ShippingMethod, Snapshot } from "./types";

// Same values as the backend settings
const HOLD_MINUTES = 15;
const MAX_QUANTITY = 10;
const ACCESS_MINUTES = 30;
const REFRESH_DAYS = 14;
const PAGE_SIZE = 50;

// The simulated warehouse
const SHIP_AFTER_MINUTES = 3;
const DELIVER_AFTER_MINUTES = 3;
const REFUND_AFTER_MINUTES = 3;

const STATE_KEY = "wardrobe.showcase";
const MINUTE = 60_000;
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ORDER_STATUS: Record<string, string> = {
  pending: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired",
};
const RETURN_STATUS: Record<string, string> = { requested: "Requested", refunded: "Received and refunded", rejected: "Rejected" };
const RETURN_REASONS: Record<string, string> = {
  too_small: "Too small",
  too_large: "Too large",
  not_as_pictured: "Not as pictured",
  changed_mind: "Changed my mind",
  faulty: "Faulty or damaged",
  other: "Other",
};

// Stored state

interface StoredUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  salt: string;
  hash: string;
}

interface StoredLine {
  id: number;
  variant: number;
  product_name: string;
  product_slug: string;
  colour: string;
  size: string;
  sku: string;
  image_url: string;
  /** Cents */
  unit_price: number;
  quantity: number;
  reserved: boolean;
}

interface StoredOrder {
  id: number;
  reference: string;
  user: number;
  status: keyof typeof ORDER_STATUS;
  email: string;
  full_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  shipping_method: ShippingMethod;
  /** Cents */
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  lines: StoredLine[];
  expires_at: number;
  created_at: number;
  paid_at: number | null;
  shipped_at: number | null;
  delivered_at: number | null;
  cancelled_at: number | null;
  tracking_number: string;
}

interface StoredPayment {
  id: number;
  order: number;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
  /** Cents */
  amount: number;
  refunded: number;
  created_at: number;
}

interface StoredReturn {
  id: number;
  reference: string;
  order: number;
  status: keyof typeof RETURN_STATUS;
  reason: string;
  note: string;
  lines: { order_line: number; quantity: number }[];
  /** Cents */
  refund_amount: number;
  staff_note: string;
  created_at: number;
  closed_at: number | null;
}

interface State {
  version: 1;
  next: number;
  users: StoredUser[];
  tokens: Record<string, { user: number; kind: "access" | "refresh"; expires: number }>;
  orders: StoredOrder[];
  payments: StoredPayment[];
  returns: StoredReturn[];
  /** Change to each variant's stock caused by this visitor, on top of the snapshot */
  stock: Record<number, number>;
}

const empty = (): State => ({ version: 1, next: 1, users: [], tokens: {}, orders: [], payments: [], returns: [], stock: {} });

// Used when localStorage is blocked: the demo then lasts as long as the page
let memory = JSON.stringify(empty());

function load(): State {
  let raw: string | null = memory;
  try {
    raw = localStorage.getItem(STATE_KEY) ?? memory;
  } catch {
    // Storage blocked: keep the copy in memory
  }
  try {
    const state = JSON.parse(raw) as State;
    return state?.version === 1 ? state : empty();
  } catch {
    return empty();
  }
}

function save(state: State) {
  const now = Date.now();
  for (const [token, t] of Object.entries(state.tokens)) if (t.expires <= now) delete state.tokens[token];
  memory = JSON.stringify(state);
  try {
    localStorage.setItem(STATE_KEY, memory);
  } catch {
    // Storage blocked or full: the copy in memory still works for this page
  }
}

const nextId = (state: State) => state.next++;

// Snapshots written at build time

let snapshot: Promise<Snapshot> | undefined;

function catalogue(): Promise<Snapshot> {
  snapshot ??= fetch(withBase("/showcase/catalog.json")).then((res) => {
    if (!res.ok) throw new Error("The showcase catalogue is missing.");
    return res.json() as Promise<Snapshot>;
  });
  snapshot.catch(() => (snapshot = undefined));
  return snapshot;
}

interface CatalogueVariant {
  id: number;
  sku: string;
  colour: string;
  size: string;
  stock: number;
  product: Snapshot["products"][number];
}

function variants(snap: Snapshot): Map<number, CatalogueVariant> {
  const map = new Map<number, CatalogueVariant>();
  for (const product of snap.products) {
    for (const [id, sku, colour, size, stock] of product.variants) map.set(id, { id, sku, colour, size, stock, product });
  }
  return map;
}

const stockOf = (state: State, v: { id: number; stock: number }) => v.stock + (state.stock[v.id] ?? 0);

/** Take stock only if there is enough of it, like the backend's conditional update. */
function take(state: State, v: CatalogueVariant | undefined, quantity: number): boolean {
  if (!v || stockOf(state, v) < quantity) return false;
  state.stock[v.id] = (state.stock[v.id] ?? 0) - quantity;
  return true;
}

const giveBack = (state: State, variant: number, quantity: number) => {
  state.stock[variant] = (state.stock[variant] ?? 0) + quantity;
};

// Responses and errors

class Reply {
  constructor(
    public status: number,
    public data: unknown,
  ) {}
}

const fail = (status: number, data: unknown) => new Reply(status, data);
const detail = (status: number, text: string) => fail(status, { detail: text });

const cents = (value: string | number) => Math.round(Number(value) * 100);
/** Decimal fields of serializers are strings, raw Decimals in a response are numbers. */
const decimal = (c: number) => (c / 100).toFixed(2);
const number = (c: number) => c / 100;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function reference(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Request validation, with Django REST framework's messages

type Body = Record<string, unknown>;
type Errors = Record<string, unknown>;

const REQUIRED = "This field is required.";
const BLANK = "This field may not be blank.";

function text(body: Body, key: string, errors: Errors, { required = true, max = 0 } = {}): string {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) errors[key] = [REQUIRED];
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed && required) errors[key] = [BLANK];
  else if (max && trimmed.length > max) errors[key] = [`Ensure this field has no more than ${max} characters.`];
  return trimmed;
}

function integer(body: Body, key: string, errors: Errors, { min, max }: { min?: number; max?: number } = {}): number {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    errors[key] = [REQUIRED];
    return 0;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) {
    errors[key] = ["A valid integer is required."];
    return 0;
  }
  if (min !== undefined && n < min) errors[key] = [`Ensure this value is greater than or equal to ${min}.`];
  if (max !== undefined && n > max) errors[key] = [`Ensure this value is less than or equal to ${max}.`];
  return n;
}

function list<T>(body: Body, key: string, errors: Errors, item: (entry: Body, errors: Errors) => T): T[] {
  const value = body[key];
  if (value === undefined || value === null) {
    errors[key] = [REQUIRED];
    return [];
  }
  if (!Array.isArray(value)) {
    errors[key] = { non_field_errors: [`Expected a list of items but got type "${typeof value === "string" ? "str" : "dict"}".`] };
    return [];
  }
  const nested: Errors = {};
  const items = value.map((entry, i) => {
    const own: Errors = {};
    const result = item(entry && typeof entry === "object" ? (entry as Body) : {}, own);
    if (Object.keys(own).length) nested[i] = own;
    return result;
  });
  if (Object.keys(nested).length) errors[key] = nested;
  return items;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bagItems(entry: Body, errors: Errors) {
  return { variant: integer(entry, "variant", errors), quantity: integer(entry, "quantity", errors, { min: 1, max: 20 }) };
}

function shippingMethod(snap: Snapshot, body: Body, errors: Errors, required: boolean): ShippingMethod | null {
  const code = body.shipping_method;
  if (code === undefined || code === null || code === "") {
    if (required) errors.shipping_method = [code === undefined ? REQUIRED : "This field may not be null."];
    return null;
  }
  const method = snap.shipping.find((m) => m.code === code);
  if (!method) errors.shipping_method = [`Object with code=${String(code)} does not exist.`];
  return method ?? null;
}

// Accounts

function authenticate(state: State, headers: Headers): StoredUser | Reply | null {
  const header = headers.get("Authorization");
  if (!header) return null;
  const token = state.tokens[header.replace(/^Bearer\s+/i, "")];
  const user = token && token.kind === "access" && token.expires > Date.now() && state.users.find((u) => u.id === token.user);
  if (!user) {
    return fail(401, {
      detail: "Given token not valid for any token type",
      code: "token_not_valid",
      messages: [{ token_class: "AccessToken", token_type: "access", message: "Token is invalid" }],
    });
  }
  return user;
}

function issue(state: State, user: StoredUser, kind: "access" | "refresh"): string {
  const token = randomHex(24);
  state.tokens[token] = { user: user.id, kind, expires: Date.now() + (kind === "access" ? ACCESS_MINUTES * MINUTE : REFRESH_DAYS * 1440 * MINUTE) };
  return token;
}

const publicUser = (u: StoredUser) => ({ id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, is_staff: false });

/** Django's normalize_email: the domain is not case-sensitive, the name might be. */
function normalizeEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? email : email.slice(0, at) + email.slice(at).toLowerCase();
}

const COMMON_PASSWORDS = new Set(
  "password password1 password123 12345678 123456789 1234567890 qwerty123 qwertyuiop iloveyou sunshine princess football baseball welcome welcome1 letmein abc12345 trustno1 superman whatever starwars dragon123 passw0rd admin123 11111111 00000000 87654321 monkey123 shadow123 master123 changeme".split(" "),
);

/** Django's SequenceMatcher.quick_ratio, used by UserAttributeSimilarityValidator. */
function quickRatio(a: string, b: string): number {
  const counts = new Map<string, number>();
  for (const ch of b) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let matches = 0;
  for (const ch of a) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      matches++;
      counts.set(ch, n - 1);
    }
  }
  return a.length + b.length ? (2 * matches) / (a.length + b.length) : 1;
}

/** The backend's AUTH_PASSWORD_VALIDATORS, with Django's messages. */
function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();
  const value = email.toLowerCase();
  const similar = [...value.split(/\W+/), value].some((part) => {
    if (!part) return false;
    const tooShort = lower.length >= 10 * part.length && part.length < 0.35 * lower.length;
    return !tooShort && quickRatio(lower, part) >= 0.7;
  });
  if (similar) problems.push("The password is too similar to the email address.");
  if (password.length < 8) problems.push("This password is too short. It must contain at least 8 characters.");
  if (COMMON_PASSWORDS.has(lower.trim())) problems.push("This password is too common.");
  if (/^\d+$/.test(password)) problems.push("This password is entirely numeric.");
  return problems;
}

async function register(body: Body): Promise<Reply> {
  const errors: Errors = {};
  const email = normalizeEmail(text(body, "email", errors, { max: 254 }));
  if (!errors.email && !EMAIL.test(email)) errors.email = ["Enter a valid email address."];
  const password = typeof body.password === "string" ? body.password : "";
  if (body.password === undefined || body.password === null) errors.password = [REQUIRED];
  else if (!password.trim()) errors.password = [BLANK];
  const first_name = text(body, "first_name", errors, { required: false, max: 150 });
  const last_name = text(body, "last_name", errors, { required: false, max: 150 });
  if (!errors.email && load().users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    errors.email = ["An account with this email already exists. Sign in instead."];
  }
  if (Object.keys(errors).length) return fail(400, errors);
  const problems = passwordProblems(password, email);
  if (problems.length) return fail(400, { non_field_errors: problems });

  const salt = randomHex(16);
  const hash = await sha256(salt + password);
  const state = load();
  if (state.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return fail(400, { email: ["An account with this email already exists. Sign in instead."] });
  }
  const user: StoredUser = { id: nextId(state), email, first_name, last_name, salt, hash };
  state.users.push(user);
  const refresh = issue(state, user, "refresh");
  const access = issue(state, user, "access");
  save(state);
  return new Reply(201, { user: publicUser(user), access, refresh });
}

async function obtainToken(body: Body): Promise<Reply> {
  const errors: Errors = {};
  const email = text(body, "email", errors);
  const password = typeof body.password === "string" ? body.password : "";
  if (body.password === undefined || body.password === null) errors.password = [REQUIRED];
  else if (!password) errors.password = [BLANK];
  if (Object.keys(errors).length) return fail(400, errors);
  const user = load().users.find((u) => u.email === email);
  if (!user || (await sha256(user.salt + password)) !== user.hash) {
    return detail(401, "No active account found with the given credentials");
  }
  const state = load();
  const tokens = { refresh: issue(state, user, "refresh"), access: issue(state, user, "access") };
  save(state);
  return new Reply(200, tokens);
}

function refreshToken(state: State, body: Body): Reply {
  const errors: Errors = {};
  const refresh = text(body, "refresh", errors);
  if (Object.keys(errors).length) return fail(400, errors);
  const token = state.tokens[refresh];
  const user = token && token.kind === "refresh" && token.expires > Date.now() && state.users.find((u) => u.id === token.user);
  if (!user) return fail(401, { detail: "Token is invalid", code: "token_not_valid" });
  return new Reply(200, { access: issue(state, user, "access") });
}

// Pricing (apps/orders/services.py)

const freeOver = (snap: Snapshot) => (snap.store.free_shipping_over === null ? null : cents(snap.store.free_shipping_over));

function shippingCost(snap: Snapshot, method: ShippingMethod, subtotal: number): number {
  const threshold = freeOver(snap);
  if (method.free_over_threshold && threshold !== null && subtotal >= threshold) return 0;
  return cents(method.price);
}

const imageFor = (v: CatalogueVariant) => v.product.images[v.colour] ?? v.product.images[""] ?? "";

interface PricedLine {
  variant: CatalogueVariant;
  quantity: number;
  line: Record<string, unknown>;
  total: number;
}

function price(state: State, snap: Snapshot, items: { variant: CatalogueVariant; quantity: number }[], method: ShippingMethod | null) {
  const lines: PricedLine[] = [];
  const problems: string[] = [];
  let subtotal = 0;
  for (const { variant: v, quantity } of items) {
    const available = Math.max(stockOf(state, v), 0);
    const unit = cents(v.product.price);
    const colour = snap.colours[v.colour] ?? v.colour;
    const size = snap.sizes[v.size] ?? v.size;
    lines.push({
      variant: v,
      quantity,
      total: unit * quantity,
      line: {
        variant: v.id,
        sku: v.sku,
        product: { slug: v.product.slug, name: v.product.name },
        colour,
        size,
        image: imageFor(v),
        unit_price: number(unit),
        compare_at_price: v.product.compare_at_price === null ? null : Number(v.product.compare_at_price),
        quantity,
        available,
        line_total: number(unit * quantity),
      },
    });
    if (available < quantity) {
      problems.push(available ? `Only ${available} left of ${v.product.name} (${colour}, ${size}).` : `${v.product.name} (${colour}, ${size}) is sold out.`);
    }
    subtotal += unit * quantity;
  }
  const shipping = method && items.length ? shippingCost(snap, method, subtotal) : 0;
  return { lines, problems, subtotal, shipping, total: subtotal + shipping };
}

function resolveItems(snap: Snapshot, raw: { variant: number; quantity: number }[]) {
  const byId = variants(snap);
  const missing = raw.find((i) => !byId.has(i.variant));
  if (missing) return fail(400, { items: `Unknown variant: ${missing.variant}.` });
  return raw.map((i) => ({ variant: byId.get(i.variant)!, quantity: i.quantity }));
}

function quote(state: State, snap: Snapshot, body: Body): Reply {
  const errors: Errors = {};
  const raw = list(body, "items", errors, bagItems);
  let method = shippingMethod(snap, body, errors, false);
  if (Object.keys(errors).length) return fail(400, errors);
  const items = resolveItems(snap, raw);
  if (items instanceof Reply) return items;
  method ??= snap.shipping[0] ?? null;
  const priced = price(state, snap, items, method);
  return new Reply(200, {
    lines: priced.lines.map((l) => l.line),
    subtotal: number(priced.subtotal),
    shipping: number(priced.shipping),
    total: number(priced.total),
    currency: snap.store.currency,
    shipping_method: method?.code ?? null,
    free_shipping_over: freeOver(snap) === null ? null : number(freeOver(snap)!),
    problems: priced.problems,
  });
}

// Orders

function close(state: State, order: StoredOrder, status: StoredOrder["status"], stamp = true) {
  for (const line of order.lines) {
    if (line.reserved) {
      giveBack(state, line.variant, line.quantity);
      line.reserved = false;
    }
  }
  order.status = status;
  if (stamp) order.cancelled_at = Date.now();
}

const returnedLines = (state: State, line: StoredLine) =>
  state.returns
    .filter((r) => r.status !== "rejected")
    .flatMap((r) => r.lines)
    .filter((l) => l.order_line === line.id)
    .reduce((n, l) => n + l.quantity, 0);

const returnable = (state: State, line: StoredLine) => line.quantity - returnedLines(state, line);

function returnDeadline(snap: Snapshot, order: StoredOrder): number | null {
  const received = order.delivered_at ?? order.shipped_at;
  return received === null ? null : received + snap.store.return_window_days * 1440 * MINUTE;
}

function canReturn(state: State, snap: Snapshot, order: StoredOrder): boolean {
  const deadline = returnDeadline(snap, order);
  return (
    (order.status === "shipped" || order.status === "delivered") &&
    deadline !== null &&
    Date.now() <= deadline &&
    order.lines.some((l) => returnable(state, l) > 0)
  );
}

function refund(payment: StoredPayment, amount?: number): number {
  if (payment.status !== "succeeded") return 0;
  const refundable = payment.amount - payment.refunded;
  const value = amount === undefined ? refundable : Math.min(amount, refundable);
  if (value <= 0) return 0;
  payment.refunded += value;
  if (payment.refunded >= payment.amount) payment.status = "refunded";
  return value;
}

function refundOrder(state: State, order: StoredOrder, amount?: number): number {
  let refunded = 0;
  for (const payment of state.payments.filter((p) => p.order === order.id && p.status === "succeeded")) {
    const left = amount === undefined ? undefined : amount - refunded;
    if (left !== undefined && left <= 0) break;
    refunded += refund(payment, left);
  }
  return refunded;
}

/**
 * What time does on the server: unpaid orders expire, and the simulated
 * warehouse ships, delivers and handles returns.
 */
function advance(state: State) {
  const now = Date.now();
  for (const order of state.orders) {
    if (order.status === "pending" && order.expires_at <= now) close(state, order, "expired", false);
    if (order.status === "paid" && order.paid_at! + SHIP_AFTER_MINUTES * MINUTE <= now) {
      order.status = "shipped";
      order.shipped_at = order.paid_at! + SHIP_AFTER_MINUTES * MINUTE;
      order.tracking_number = order.shipping_method.code === "pickup" ? "" : `TRK${String(order.id).padStart(4, "0")}${order.reference.slice(0, 4)}`;
    }
    if (order.status === "shipped" && order.shipped_at! + DELIVER_AFTER_MINUTES * MINUTE <= now) {
      order.status = "delivered";
      order.delivered_at = order.shipped_at! + DELIVER_AFTER_MINUTES * MINUTE;
    }
  }
  for (const request of state.returns) {
    if (request.status !== "requested" || request.created_at + REFUND_AFTER_MINUTES * MINUTE > now) continue;
    const order = state.orders.find((o) => o.id === request.order)!;
    for (const pick of request.lines) {
      const line = order.lines.find((l) => l.id === pick.order_line);
      if (line) giveBack(state, line.variant, pick.quantity);
    }
    request.status = "refunded";
    request.closed_at = request.created_at + REFUND_AFTER_MINUTES * MINUTE;
    request.refund_amount = refundOrder(state, order, returnValue(state, request));
  }
}

function returnValue(state: State, request: StoredReturn): number {
  const order = state.orders.find((o) => o.id === request.order)!;
  return request.lines.reduce((sum, pick) => sum + (order.lines.find((l) => l.id === pick.order_line)?.unit_price ?? 0) * pick.quantity, 0);
}

function serializeOrder(state: State, snap: Snapshot, o: StoredOrder) {
  const deadline = returnDeadline(snap, o);
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    status_label: ORDER_STATUS[o.status],
    email: o.email,
    full_name: o.full_name,
    address_line1: o.address_line1,
    address_line2: o.address_line2,
    city: o.city,
    postal_code: o.postal_code,
    country: o.country,
    phone: o.phone,
    shipping_method: o.shipping_method,
    subtotal: decimal(o.subtotal),
    shipping: decimal(o.shipping),
    total: decimal(o.total),
    currency: o.currency,
    lines: o.lines.map((l) => ({
      id: l.id,
      variant: l.variant,
      product_name: l.product_name,
      product_slug: l.product_slug,
      colour: l.colour,
      size: l.size,
      sku: l.sku,
      image_url: l.image_url,
      unit_price: decimal(l.unit_price),
      quantity: l.quantity,
      line_total: decimal(l.unit_price * l.quantity),
      returnable: returnable(state, l),
    })),
    expires_at: iso(o.expires_at),
    created_at: iso(o.created_at),
    paid_at: iso(o.paid_at),
    shipped_at: iso(o.shipped_at),
    delivered_at: iso(o.delivered_at),
    cancelled_at: iso(o.cancelled_at),
    tracking_number: o.tracking_number,
    can_cancel: o.status === "pending" || o.status === "paid",
    can_return: canReturn(state, snap, o),
    return_deadline: iso(deadline),
    returns: state.returns
      .filter((r) => r.order === o.id)
      .sort((a, b) => b.created_at - a.created_at)
      .map((r) => ({ id: r.id, reference: r.reference, status: r.status, refund_amount: number(r.refund_amount), created_at: iso(r.created_at) })),
    customer: null,
    payments: null,
  };
}

const page = <T>(results: T[]) => ({
  count: results.length,
  next: results.length > PAGE_SIZE ? "?page=2" : null,
  previous: null,
  results: results.slice(0, PAGE_SIZE),
});

function placeOrder(state: State, snap: Snapshot, user: StoredUser, body: Body): Reply {
  const errors: Errors = {};
  const raw = list(body, "items", errors, bagItems);
  const method = shippingMethod(snap, body, errors, true);
  const address = body.address;
  if (address === undefined || address === null) errors.address = [REQUIRED];
  else if (typeof address !== "object" || Array.isArray(address)) {
    errors.address = { non_field_errors: ["Invalid data. Expected a dictionary, but got list."] };
  }
  const a = (address && typeof address === "object" ? address : {}) as Body;
  const own: Errors = {};
  const fields = {
    full_name: text(a, "full_name", own, { max: 120 }),
    address_line1: text(a, "address_line1", own, { max: 200 }),
    address_line2: text(a, "address_line2", own, { required: false, max: 200 }),
    city: text(a, "city", own, { max: 120 }),
    postal_code: text(a, "postal_code", own, { max: 20 }),
    country: text(a, "country", own),
    phone: text(a, "phone", own, { required: false, max: 40 }),
    email: text(a, "email", own, { required: false }),
  };
  if (!own.country && !/^[A-Za-z]{2}$/.test(fields.country)) own.country = ["Use the two-letter country code, for example IT."];
  if (fields.email && !EMAIL.test(fields.email)) own.email = ["Enter a valid email address."];
  if (!errors.address && Object.keys(own).length) errors.address = own;
  if (Object.keys(errors).length) return fail(400, errors);

  const resolved = resolveItems(snap, raw);
  if (resolved instanceof Reply) return resolved;
  // The same variant twice becomes one line
  const items: { variant: CatalogueVariant; quantity: number }[] = [];
  for (const item of resolved) {
    const existing = items.find((i) => i.variant.id === item.variant.id);
    if (existing) existing.quantity += item.quantity;
    else items.push({ ...item });
  }
  if (!items.length) return detail(400, "Your bag is empty.");
  if (items.reduce((n, i) => n + i.quantity, 0) > MAX_QUANTITY) return detail(400, `You can order up to ${MAX_QUANTITY} pieces at a time.`);

  const priced = price(state, snap, items, method);
  // Placing a new order replaces the previous unpaid one, so stock is not held twice
  for (const previous of state.orders.filter((o) => o.user === user.id && o.status === "pending")) close(state, previous, "cancelled");

  const now = Date.now();
  const order: StoredOrder = {
    id: nextId(state),
    reference: reference(),
    user: user.id,
    status: "pending",
    email: fields.email || user.email,
    full_name: fields.full_name,
    address_line1: fields.address_line1,
    address_line2: fields.address_line2,
    city: fields.city,
    postal_code: fields.postal_code,
    country: fields.country.toUpperCase(),
    phone: fields.phone,
    shipping_method: method!,
    subtotal: priced.subtotal,
    shipping: priced.shipping,
    total: priced.total,
    currency: snap.store.currency,
    lines: [],
    expires_at: now + HOLD_MINUTES * MINUTE,
    created_at: now,
    paid_at: null,
    shipped_at: null,
    delivered_at: null,
    cancelled_at: null,
    tracking_number: "",
  };
  const missing: { variant: number; name: string; colour: string; size: string }[] = [];
  for (const { variant: v, quantity, line } of priced.lines) {
    if (!take(state, v, quantity)) {
      missing.push({ variant: v.id, name: v.product.name, colour: String(line.colour), size: String(line.size) });
      continue;
    }
    order.lines.push({
      id: nextId(state),
      variant: v.id,
      product_name: v.product.name,
      product_slug: v.product.slug,
      colour: String(line.colour),
      size: String(line.size),
      sku: v.sku,
      image_url: String(line.image),
      unit_price: cents(v.product.price),
      quantity,
      reserved: true,
    });
  }
  if (missing.length) {
    // Nothing is saved, so every reservation above is rolled back
    const names = missing.map((i) => `${i.name} (${i.colour}, ${i.size})`).join(", ");
    return fail(409, { detail: `Not enough stock for: ${names}.`, items: missing });
  }
  state.orders.push(order);
  save(state);
  return new Reply(201, serializeOrder(state, snap, order));
}

function startCheckout(state: State, order: StoredOrder): Reply {
  if (order.status !== "pending" || order.expires_at <= Date.now()) {
    return detail(409, "This order can no longer be paid. Your bag is still there: place the order again.");
  }
  // A new attempt replaces any unfinished one
  for (const p of state.payments) if (p.order === order.id && p.status === "pending") p.status = "cancelled";
  const payment: StoredPayment = { id: nextId(state), order: order.id, status: "pending", amount: order.total, refunded: 0, created_at: Date.now() };
  state.payments.push(payment);
  save(state);
  return new Reply(201, {
    payment_id: payment.id,
    provider: "fake",
    amount: number(payment.amount),
    currency: order.currency,
    client_secret: `fake_${randomHex(16)}_secret`,
  });
}

/** apps/orders/services.confirm: false when the order cannot be kept and the payment must be refunded. */
function confirm(state: State, snap: Snapshot, order: StoredOrder): boolean {
  if (order.status === "paid" || order.status === "shipped" || order.status === "delivered") return true;
  if (order.status !== "pending" && order.status !== "expired") return false;
  if (order.status === "expired") {
    // Paid after the deadline: keep the order only if every piece is still in stock
    const byId = variants(snap);
    const before = { ...state.stock };
    for (const line of order.lines) {
      if (!take(state, byId.get(line.variant), line.quantity)) {
        state.stock = before;
        return false;
      }
    }
    order.lines.forEach((l) => (l.reserved = true));
  }
  order.status = "paid";
  order.paid_at = Date.now();
  return true;
}

function completeFakePayment(state: State, snap: Snapshot, user: StoredUser, body: Body): Reply {
  const errors: Errors = {};
  const id = integer(body, "payment_id", errors);
  const outcome = body.outcome ?? "succeeded";
  if (outcome !== "succeeded" && outcome !== "failed") errors.outcome = [`"${String(outcome)}" is not a valid choice.`];
  if (Object.keys(errors).length) return fail(400, errors);
  const payment = state.payments.find((p) => p.id === id && state.orders.some((o) => o.id === p.order && o.user === user.id));
  if (!payment) return detail(404, "No Payment matches the given query.");
  const order = state.orders.find((o) => o.id === payment.order)!;

  if (payment.status !== "succeeded" && payment.status !== "refunded") {
    if (outcome === "failed") {
      if (payment.status === "pending") payment.status = "failed";
    } else {
      // Money was taken, even if this attempt had been replaced: honour it
      payment.status = "succeeded";
      const alreadyPaid = order.status === "paid" || order.status === "shipped" || order.status === "delivered";
      // Paid twice, or paid too late for stock that is now gone
      if (alreadyPaid || !confirm(state, snap, order)) refund(payment);
    }
  }
  save(state);
  return new Reply(200, { payment_status: payment.status, order_status: order.status });
}

function cancelOrder(state: State, snap: Snapshot, order: StoredOrder): Reply {
  if (order.status === "cancelled" || order.status === "expired") return detail(400, "This order is no longer active.");
  if (order.status === "shipped" || order.status === "delivered") {
    return detail(400, "This order has already left the warehouse. Request a return instead.");
  }
  if (order.status === "paid") refundOrder(state, order);
  close(state, order, "cancelled");
  save(state);
  return new Reply(200, serializeOrder(state, snap, order));
}

// Returns (apps/returns/services.py)

function serializeReturn(state: State, r: StoredReturn) {
  const order = state.orders.find((o) => o.id === r.order)!;
  return {
    id: r.id,
    reference: r.reference,
    order: { id: order.id, reference: order.reference, currency: order.currency, email: order.email, full_name: order.full_name },
    status: r.status,
    status_label: RETURN_STATUS[r.status],
    reason: r.reason,
    reason_label: RETURN_REASONS[r.reason] ?? r.reason,
    note: r.note,
    lines: r.lines.map((pick) => {
      const l = order.lines.find((x) => x.id === pick.order_line)!;
      return {
        order_line: l.id,
        product_name: l.product_name,
        product_slug: l.product_slug,
        colour: l.colour,
        size: l.size,
        sku: l.sku,
        image_url: l.image_url,
        unit_price: decimal(l.unit_price),
        quantity: pick.quantity,
      };
    }),
    value: number(returnValue(state, r)),
    refund_amount: decimal(r.refund_amount),
    staff_note: r.staff_note,
    created_at: iso(r.created_at),
    closed_at: iso(r.closed_at),
  };
}

function requestReturn(state: State, snap: Snapshot, user: StoredUser, body: Body): Reply {
  const errors: Errors = {};
  const orderId = integer(body, "order", errors);
  const picks = list(body, "lines", errors, (entry, own) => ({
    order_line: integer(entry, "order_line", own),
    quantity: integer(entry, "quantity", own, { min: 1 }),
  }));
  const reason = body.reason;
  if (reason === undefined || reason === null) errors.reason = [REQUIRED];
  else if (!(String(reason) in RETURN_REASONS)) errors.reason = [`"${String(reason)}" is not a valid choice.`];
  const note = text(body, "note", errors, { required: false, max: 1000 });
  if (Object.keys(errors).length) return fail(400, errors);

  const order = state.orders.find((o) => o.id === orderId && o.user === user.id);
  if (!order) return fail(400, { order: "Order not found." });
  const allLines = new Map(state.orders.flatMap((o) => o.lines.map((l) => [l.id, { line: l, order: o.id }] as const)));
  if (picks.some((p) => !allLines.has(p.order_line))) return fail(400, { lines: "Some pieces are not part of this order." });

  if (order.status !== "shipped" && order.status !== "delivered") return detail(400, "Returns open once the order has shipped.");
  const deadline = returnDeadline(snap, order);
  if (deadline === null || Date.now() > deadline) return detail(400, "The return window for this order has closed.");
  const chosen = picks.filter((p) => p.quantity > 0);
  if (!chosen.length) return detail(400, "Choose at least one piece to return.");
  for (const p of chosen) {
    const { line, order: owner } = allLines.get(p.order_line)!;
    if (owner !== order.id) return detail(400, "Some pieces are not part of this order.");
    if (p.quantity > returnable(state, line)) return detail(400, `${line.product_name} (${line.size}) cannot be returned in that quantity.`);
  }

  const request: StoredReturn = {
    id: nextId(state),
    reference: reference(),
    order: order.id,
    status: "requested",
    reason: String(reason),
    note,
    lines: chosen,
    refund_amount: 0,
    staff_note: "",
    created_at: Date.now(),
    closed_at: null,
  };
  state.returns.push(request);
  save(state);
  return new Reply(201, serializeReturn(state, request));
}

// Products

async function product(state: State, slug: string): Promise<Reply> {
  const res = await fetch(withBase(`/showcase/products/${encodeURIComponent(slug)}.json`));
  if (!res.ok) return detail(404, "No Product matches the given query.");
  const p = (await res.json()) as Product;
  p.variants = p.variants.map((v) => ({ ...v, stock: Math.max(stockOf(state, v), 0) }));
  p.in_stock = p.variants.some((v) => v.stock > 0);
  return new Reply(200, p);
}

// Routing

async function route(method: string, path: string, headers: Headers, body: Body): Promise<Reply> {
  const notAllowed = () => detail(405, `Method "${method}" not allowed.`);
  const snap = await catalogue();

  // Requests that hash a password do it before touching the state
  if (path === "/auth/register/") return method === "POST" ? register(body) : notAllowed();
  if (path === "/auth/token/") return method === "POST" ? obtainToken(body) : notAllowed();

  const state = load();
  advance(state);
  save(state);

  const user = authenticate(state, headers);
  if (user instanceof Reply) return user;
  const signedIn = (): StoredUser | Reply => user ?? detail(401, "Authentication credentials were not provided.");

  if (path === "/health/") return new Reply(200, { status: "ok" });
  if (path === "/store/") return method === "GET" ? new Reply(200, snap.store) : notAllowed();
  if (path === "/shipping-methods/") return method === "GET" ? new Reply(200, snap.shipping) : notAllowed();
  if (path === "/payments/config/") return method === "GET" ? new Reply(200, { provider: "fake" }) : notAllowed();
  if (path === "/auth/token/refresh/") {
    if (method !== "POST") return notAllowed();
    const reply = refreshToken(state, body);
    save(state);
    return reply;
  }
  if (path === "/bag/quote/") return method === "POST" ? quote(state, snap, body) : notAllowed();

  const productMatch = path.match(/^\/products\/([^/]+)\/$/);
  if (productMatch) return method === "GET" ? product(state, decodeURIComponent(productMatch[1])) : notAllowed();

  if (path === "/auth/me/") {
    const u = signedIn();
    if (u instanceof Reply) return u;
    if (method === "GET") return new Reply(200, publicUser(u));
    if (method !== "PUT" && method !== "PATCH") return notAllowed();
    const errors: Errors = {};
    const changes = {
      first_name: text(body, "first_name", errors, { required: false, max: 150 }),
      last_name: text(body, "last_name", errors, { required: false, max: 150 }),
    };
    if (Object.keys(errors).length) return fail(400, errors);
    const stored = state.users.find((x) => x.id === u.id)!;
    if (body.first_name !== undefined) stored.first_name = changes.first_name;
    if (body.last_name !== undefined) stored.last_name = changes.last_name;
    save(state);
    return new Reply(200, publicUser(stored));
  }

  if (path === "/payments/fake/complete/") {
    const u = signedIn();
    if (u instanceof Reply) return u;
    return method === "POST" ? completeFakePayment(state, snap, u, body) : notAllowed();
  }

  if (path === "/orders/" || path.startsWith("/orders/")) {
    const u = signedIn();
    if (u instanceof Reply) return u;
    const mine = state.orders.filter((o) => o.user === u.id);
    if (path === "/orders/") {
      if (method === "POST") return placeOrder(state, snap, u, body);
      if (method !== "GET") return notAllowed();
      return new Reply(200, page(mine.sort((a, b) => b.created_at - a.created_at).map((o) => serializeOrder(state, snap, o))));
    }
    const match = path.match(/^\/orders\/(\d+)\/(?:(checkout|cancel)\/)?$/);
    const order = match && mine.find((o) => o.id === Number(match[1]));
    if (!match) return detail(404, "Not found.");
    if (!order) return detail(404, "No Order matches the given query.");
    if (!match[2]) return method === "GET" ? new Reply(200, serializeOrder(state, snap, order)) : notAllowed();
    if (method !== "POST") return notAllowed();
    return match[2] === "checkout" ? startCheckout(state, order) : cancelOrder(state, snap, order);
  }

  if (path === "/returns/") {
    const u = signedIn();
    if (u instanceof Reply) return u;
    if (method === "POST") return requestReturn(state, snap, u, body);
    if (method !== "GET") return notAllowed();
    const ids = new Set(state.orders.filter((o) => o.user === u.id).map((o) => o.id));
    const mine = state.returns.filter((r) => ids.has(r.order)).sort((a, b) => b.created_at - a.created_at);
    return new Reply(200, page(mine.map((r) => serializeReturn(state, r))));
  }

  return detail(404, "Not found.");
}

/** Answer a request meant for the API, as `fetch` would. `url` is the API path, for example `/bag/quote/`. */
export async function respond(url: string, init: RequestInit = {}): Promise<Response> {
  const path = url.split("?")[0];
  let body: Body = {};
  try {
    body = typeof init.body === "string" ? (JSON.parse(init.body) as Body) : {};
  } catch {
    return json(new Reply(400, { detail: "JSON parse error." }));
  }
  let reply: Reply;
  try {
    reply = await route((init.method ?? "GET").toUpperCase(), path, new Headers(init.headers), body && typeof body === "object" ? body : {});
  } catch (err) {
    console.error(err);
    reply = new Reply(500, {});
  }
  return json(reply);
}

function json(reply: Reply): Response {
  return new Response(JSON.stringify(reply.data), { status: reply.status, headers: { "Content-Type": "application/json" } });
}
