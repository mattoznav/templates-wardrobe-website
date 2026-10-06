/**
 * Checkout: account, delivery, then payment.
 *
 * Placing the order reserves the stock for a few minutes. The page then pays
 * with whatever provider the backend uses: the fake provider (demo buttons) or
 * Stripe (Payment Element, then wait for the webhook to mark the order paid).
 * `/checkout/?order=<id>` resumes paying for an order already placed.
 */
import { bagLines, clearBag, readBag } from "../lib/bag";
import {
  ApiError,
  cancelOrder,
  checkout,
  completeFakePayment,
  getOrder,
  isSignedIn,
  me,
  placeOrder,
  quote,
  signOut,
  type Address,
  type Checkout,
} from "../lib/client";
import { money } from "../lib/format";
import { img } from "../lib/image";
import type { Order } from "../lib/types";
import { initAuthForms } from "./auth-form";
import { esc } from "./html";
import { withBase } from "../lib/paths";

const CONFIRM_TIMEOUT_MS = 45_000;
const ADDRESS_KEY = "wardrobe.address";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let order: Order | null = null;
let payment: Checkout | null = null;
let countdown = 0;

function show(step: "form" | "confirming" | "done" | "error" | "empty") {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== step));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function message(selector: string, text: string | null) {
  const el = $(selector);
  el.textContent = text ?? "";
  el.hidden = !text;
}

function fail(title: string, text: string) {
  $("[data-error-title]").textContent = title;
  $("[data-error-text]").textContent = text;
  show("error");
}

function selectedMethod(): string {
  return document.querySelector<HTMLInputElement>('input[name="shipping_method"]:checked')?.value ?? "standard";
}

// Summary

function renderSummary(lines: { image: string; name: string; colour: string; size: string; quantity: number; total: string | number }[], currency: string) {
  $("[data-summary-lines]").innerHTML = lines
    .map(
      (l) => `<li>
        <span class="thumb"><span class="photo">${l.image ? `<img src="${img(l.image, 112, 150)}" alt="" />` : ""}</span><span class="qty">${l.quantity}</span></span>
        <span><span>${esc(l.name)}</span><br /><span class="meta">${esc(l.colour)} · ${esc(l.size)}</span></span>
        <span class="price">${money(l.total, currency)}</span>
      </li>`,
    )
    .join("");
}

function renderTotals(subtotal: string, shipping: string, total: string, currency: string) {
  $("[data-subtotal]").textContent = money(subtotal, currency);
  $("[data-shipping]").textContent = Number(shipping) ? money(shipping, currency) : "Free";
  $("[data-total]").textContent = money(total, currency);
}

async function refreshQuote(): Promise<boolean> {
  const items = readBag();
  if (!items.length) return false;
  const q = await quote(bagLines(items), selectedMethod());
  renderSummary(
    q.lines.map((l) => ({ image: l.image, name: l.product.name, colour: l.colour, size: l.size, quantity: l.quantity, total: l.line_total })),
    q.currency,
  );
  renderTotals(q.subtotal, q.shipping, q.total, q.currency);
  // Show what each method would cost for this bag
  const freeOver = Number(q.free_shipping_over);
  document.querySelectorAll<HTMLElement>("[data-method-price]").forEach((el) => {
    const code = el.dataset.methodPrice;
    if (code === "standard" && freeOver && Number(q.subtotal) >= freeOver) el.textContent = "Free";
  });
  const problems = $("[data-problems]");
  problems.hidden = q.problems.length === 0;
  problems.innerHTML = q.problems.map((p) => `<li>${esc(p)}</li>`).join("");
  $<HTMLButtonElement>("[data-place]").disabled = q.problems.length > 0;
  return true;
}

// Account

async function renderAccount() {
  const signedIn = isSignedIn();
  $("[data-signed-out]").hidden = signedIn;
  $("[data-signed-in]").hidden = !signedIn;
  if (!signedIn) return;
  try {
    const user = await me();
    $("[data-user-email]").textContent = user.email;
    const name = $<HTMLInputElement>("#full_name");
    if (!name.value) name.value = `${user.first_name} ${user.last_name}`.trim();
    document.querySelector("[data-first-name]")!.textContent = user.first_name || "it's on its way";
  } catch {
    // Expired session: the client already signed out
  }
}

function saveAddress(address: Address) {
  try {
    localStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
  } catch {
    // Not essential
  }
}

function restoreAddress() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADDRESS_KEY) ?? "null") as Record<string, string> | null;
    if (!saved) return;
    for (const [key, value] of Object.entries(saved)) {
      const input = document.querySelector<HTMLInputElement>(`[data-address-form] [name="${key}"]`);
      if (input && value) input.value = value;
    }
  } catch {
    // Ignore a broken saved address
  }
}

// Placing the order

async function place(e: SubmitEvent) {
  e.preventDefault();
  message("[data-form-error]", null);
  if (!isSignedIn()) {
    message("[data-form-error]", "Sign in or create an account first.");
    $("[data-account-step]").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const missing = ["full_name", "address_line1", "postal_code", "city", "country"].filter((k) => !data[k]?.trim());
  if (missing.length) {
    message("[data-form-error]", "Fill in your name and full delivery address.");
    form.querySelector<HTMLInputElement>(`[name="${missing[0]}"]`)?.focus();
    return;
  }
  const address: Address = {
    full_name: data.full_name.trim(),
    address_line1: data.address_line1.trim(),
    address_line2: data.address_line2?.trim(),
    city: data.city.trim(),
    postal_code: data.postal_code.trim(),
    country: data.country.trim().toUpperCase(),
    phone: data.phone?.trim(),
  };
  saveAddress(address);

  const button = $<HTMLButtonElement>("[data-place]");
  button.disabled = true;
  try {
    order = await placeOrder(bagLines(), data.shipping_method, address);
    history.replaceState(null, "", `?order=${order.id}`);
    await startPayment();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) await refreshQuote().catch(() => undefined);
    message("[data-form-error]", err instanceof ApiError ? err.message : "The order could not be placed. Try again.");
  } finally {
    button.disabled = false;
  }
}

// Payment

function startCountdown(expiresAt: string) {
  window.clearInterval(countdown);
  const end = new Date(expiresAt).getTime();
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    $("[data-countdown]").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    $("[data-hold]").toggleAttribute("data-urgent", left < 60);
    if (left === 0) {
      window.clearInterval(countdown);
      fail("Time is up", "Your pieces were released because the payment was not completed in time. Your bag is still there: place the order again.");
    }
  };
  tick();
  countdown = window.setInterval(tick, 1000);
}

async function startPayment() {
  if (!order) return;
  renderSummary(
    order.lines.map((l) => ({ image: l.image_url, name: l.product_name, colour: l.colour, size: l.size, quantity: l.quantity, total: l.line_total })),
    order.currency,
  );
  renderTotals(order.subtotal, order.shipping, order.total, order.currency);
  $<HTMLFormElement>("[data-address-form]").hidden = true;
  $("[data-account-step]").hidden = true;
  $("[data-pay-step]").hidden = false;
  message("[data-pay-error]", null);
  startCountdown(order.expires_at);

  payment = await checkout(order.id);
  const label = `Pay ${money(payment.amount, payment.currency)}`;
  if (payment.provider === "fake") {
    $("[data-fake]").hidden = false;
    $("[data-fake-pay]").textContent = label;
  } else {
    $("[data-stripe]").hidden = false;
    $("[data-stripe-pay]").textContent = label;
    await mountStripe(payment);
  }
}

async function payFake(outcome: "succeeded" | "failed") {
  if (!payment || !order) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-fake] button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await completeFakePayment(payment.payment_id, outcome);
    if (result.order_status === "paid") return finish();
    message("[data-pay-error]", "Your card was declined. No money was taken. Try again or use another card.");
    payment = await checkout(order.id); // a fresh attempt for the retry
  } catch (err) {
    message("[data-pay-error]", err instanceof ApiError ? err.message : "Payment could not be completed. Try again.");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function editOrder() {
  if (!order) return;
  try {
    await cancelOrder(order.id);
  } catch {
    // Already expired: the stock is free either way
  }
  window.clearInterval(countdown);
  order = null;
  payment = null;
  history.replaceState(null, "", location.pathname);
  $("[data-fake]").hidden = true;
  $("[data-stripe]").hidden = true;
  $("[data-pay-step]").hidden = true;
  $<HTMLFormElement>("[data-address-form]").hidden = false;
  $("[data-account-step]").hidden = false;
  await refreshQuote();
}

// Stripe: loaded only when the backend uses it

declare global {
  interface Window {
    Stripe?: (key: string) => any;
  }
}

let stripe: any;
let elements: any;

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Stripe could not be loaded."));
    document.head.append(script);
  });
}

async function mountStripe(p: Checkout) {
  await loadStripeJs();
  stripe = window.Stripe!(p.publishable_key!);
  elements = stripe.elements({
    clientSecret: p.client_secret,
    appearance: {
      theme: "flat",
      variables: { colorPrimary: "#1d1b18", colorBackground: "#fbf9f5", borderRadius: "0px", fontFamily: "system-ui, sans-serif" },
    },
  });
  elements.create("payment").mount("[data-stripe-element]");
}

async function payStripe(e: SubmitEvent) {
  e.preventDefault();
  const button = $<HTMLButtonElement>("[data-stripe-pay]");
  button.disabled = true;
  const { error } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: location.href } });
  button.disabled = false;
  if (error) return message("[data-pay-error]", error.message ?? "Payment could not be completed.");
  // Stripe tells the backend through a webhook: wait for it
  show("confirming");
  const started = Date.now();
  while (Date.now() - started < CONFIRM_TIMEOUT_MS) {
    const latest = await getOrder(order!.id);
    if (latest.status === "paid") return finish(latest);
    if (latest.status !== "pending") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail("Still confirming", "Your payment went through but the confirmation is taking longer than usual. Your order will appear in your account shortly.");
}

async function finish(latest?: Order) {
  window.clearInterval(countdown);
  order = latest ?? (await getOrder(order!.id));
  clearBag();
  $("[data-reference]").textContent = order.reference;
  $<HTMLAnchorElement>("[data-order-link]").href = withBase(`/account/?order=${order.id}`);
  show("done");
}

// Entry point

async function resume(id: number) {
  try {
    order = await getOrder(id);
  } catch {
    return fail("Order not found", "This order does not exist or belongs to another account.");
  }
  if (order.status === "paid" || order.status === "shipped" || order.status === "delivered") return finish(order);
  if (order.status !== "pending" || new Date(order.expires_at) <= new Date()) {
    return fail("This order expired", "The pieces were released because the payment was not completed in time. Place the order again from your bag.");
  }
  await startPayment();
}

export function initCheckout() {
  initAuthForms();
  restoreAddress();
  $<HTMLFormElement>("[data-address-form]").addEventListener("submit", place);
  $("[data-fake-pay]").addEventListener("click", () => payFake("succeeded"));
  $("[data-fake-decline]").addEventListener("click", () => payFake("failed"));
  $<HTMLFormElement>("[data-stripe]").addEventListener("submit", payStripe);
  $("[data-edit-order]").addEventListener("click", editOrder);
  $("[data-sign-out]").addEventListener("click", () => signOut());
  document.querySelectorAll<HTMLInputElement>('input[name="shipping_method"]').forEach((i) =>
    i.addEventListener("change", () => refreshQuote().catch(() => undefined)),
  );
  window.addEventListener("auth-change", () => {
    renderAccount();
    const resumeId = Number(new URLSearchParams(location.search).get("order"));
    if (resumeId && isSignedIn() && !order) resume(resumeId);
  });

  renderAccount();
  const resumeId = Number(new URLSearchParams(location.search).get("order"));
  if (resumeId) {
    if (isSignedIn()) resume(resumeId);
    return;
  }
  if (!readBag().length) return show("empty");
  refreshQuote().catch(() => message("[data-form-error]", "The shop cannot be reached right now. Try again in a moment."));
}
