/** Account: orders with their progress, cancellations and return requests. */
import { ApiError, cancelOrder, getOrder, isSignedIn, me, myOrders, myReturns, requestReturn, signOut } from "../lib/client";
import { country, longDate, money, shortDate } from "../lib/format";
import { img } from "../lib/image";
import type { Order, ReturnRequest } from "../lib/types";
import { initAuthForms } from "./auth-form";
import { esc } from "./html";
import { withBase } from "../lib/paths";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const TONE: Record<string, string> = {
  paid: "",
  shipped: "good",
  delivered: "good",
  pending: "warn",
  cancelled: "",
  expired: "",
  requested: "warn",
  refunded: "good",
  rejected: "",
};

const status = (code: string, label: string) => `<span class="status ${TONE[code] ? `status--${TONE[code]}` : ""}">${esc(label)}</span>`;

let orders: Order[] = [];
let current: Order | null = null;

function orderRow(o: Order): string {
  const pieces = o.lines.reduce((n, l) => n + l.quantity, 0);
  return `<button type="button" class="order-row" data-open="${o.id}">
    <span class="order-row__main">
      <span class="order-row__ref">${esc(o.reference)}</span>
      <span class="muted">${longDate(o.created_at)} · ${pieces} ${pieces === 1 ? "piece" : "pieces"} · ${money(o.total, o.currency)}</span>
    </span>
    <span class="order-row__thumbs">${o.lines
      .slice(0, 3)
      .map((l) => `<span class="photo">${l.image_url ? `<img src="${img(l.image_url, 88, 118)}" alt="" loading="lazy" />` : ""}</span>`)
      .join("")}</span>
    ${status(o.status, o.status_label)}
  </button>`;
}

function returnRow(r: ReturnRequest): string {
  const pieces = r.lines.map((l) => `${esc(l.product_name)} (${esc(l.size)})${l.quantity > 1 ? ` ×${l.quantity}` : ""}`).join(", ");
  const amount = r.status === "refunded" ? `Refunded ${money(r.refund_amount, r.order.currency)}` : `Value ${money(r.value, r.order.currency)}`;
  return `<div class="order-row" style="cursor: default">
    <span class="order-row__main">
      <span class="order-row__ref">${esc(r.reference)}</span>
      <span class="muted">Order ${esc(r.order.reference)} · ${shortDate(r.created_at)} · ${esc(r.reason_label)}</span>
      <span>${pieces}</span>
      ${r.staff_note && r.status === "rejected" ? `<span class="muted">${esc(r.staff_note)}</span>` : ""}
    </span>
    <span class="muted">${amount}</span>
    ${status(r.status, r.status_label)}
  </div>`;
}

function timeline(o: Order): string {
  if (o.status === "cancelled" || o.status === "expired") {
    return `<p class="notice">${o.status === "cancelled" ? `Cancelled on ${longDate(o.cancelled_at!)}. Any payment was refunded in full.` : "This order expired before it was paid. Nothing was charged."}</p>`;
  }
  const steps = [
    ["Placed", o.created_at],
    ["Paid", o.paid_at],
    ["Shipped", o.shipped_at],
    ["Delivered", o.delivered_at],
  ] as const;
  return `<ol class="timeline">${steps
    .map(([label, at]) => `<li class="${at ? "is-done" : ""}"><strong>${label}</strong>${at ? shortDate(at) : ""}</li>`)
    .join("")}</ol>`;
}

function renderOrder(o: Order) {
  current = o;
  const pending = o.status === "pending" && new Date(o.expires_at) > new Date();
  $("[data-order-body]").innerHTML = `
    <header class="order__head">
      <div>
        <span class="eyebrow">Order placed ${longDate(o.created_at)}</span>
        <h1>${esc(o.reference)}</h1>
      </div>
      ${status(o.status, o.status_label)}
    </header>
    ${timeline(o)}
    <div class="order__grid">
      <ul class="order__lines">${o.lines
        .map(
          (l) => `<li>
            <a class="photo" href="${withBase(`/products/${esc(l.product_slug)}/`)}">${l.image_url ? `<img src="${img(l.image_url, 160, 214)}" alt="" />` : ""}</a>
            <div><a href="${withBase(`/products/${esc(l.product_slug)}/`)}">${esc(l.product_name)}</a><p class="muted">${esc(l.colour)} · ${esc(l.size)} · Qty ${l.quantity}</p></div>
            <span class="price">${money(l.line_total, o.currency)}</span>
          </li>`,
        )
        .join("")}</ul>
      <aside class="order__side">
        <div>
          <span class="eyebrow">Delivery</span>
          <p>${esc(o.full_name)}<br />${esc(o.address_line1)}${o.address_line2 ? `, ${esc(o.address_line2)}` : ""}<br />${esc(o.postal_code)} ${esc(o.city)}, ${esc(country(o.country))}</p>
          <p class="muted">${esc(o.shipping_method.name)}${o.tracking_number ? ` · Tracking ${esc(o.tracking_number)}` : ""}</p>
        </div>
        <dl>
          <div><dt>Subtotal</dt><dd>${money(o.subtotal, o.currency)}</dd></div>
          <div><dt>Delivery</dt><dd>${Number(o.shipping) ? money(o.shipping, o.currency) : "Free"}</dd></div>
          <div class="total"><dt>Total</dt><dd>${money(o.total, o.currency)}</dd></div>
        </dl>
        ${
          o.returns.length
            ? `<p class="muted">Returns: ${o.returns.map((r) => `${esc(r.reference)} (${esc(r.status)})`).join(", ")}</p>`
            : ""
        }
        <div class="order__actions">
          ${pending ? `<a class="btn btn--solid btn--block" href="${withBase(`/checkout/?order=${o.id}`)}">Complete payment</a>` : ""}
          ${o.can_return ? `<button type="button" class="btn btn--block" data-start-return>Return pieces</button>` : ""}
          ${o.can_return && o.return_deadline ? `<p class="muted">Returns open until ${longDate(o.return_deadline)}.</p>` : ""}
          ${o.can_cancel ? `<button type="button" class="text-link" data-cancel>Cancel this order</button>` : ""}
          <p class="form-error" data-order-error hidden></p>
        </div>
      </aside>
    </div>`;
  $("[data-return-form]").hidden = true;
  $("[data-order]").hidden = false;
  document.querySelector<HTMLElement>("[data-signed-in]")!.hidden = true;
  window.scrollTo({ top: 0 });
}

function startReturn() {
  if (!current) return;
  const lines = current.lines.filter((l) => l.returnable > 0);
  $("[data-return-lines]").innerHTML = lines
    .map(
      (l) => `<label class="return-line">
        <input type="checkbox" name="line" value="${l.id}" />
        <span>${esc(l.product_name)}<br /><span class="muted">${esc(l.colour)} · ${esc(l.size)}</span></span>
        <select name="qty-${l.id}" aria-label="Quantity">${Array.from({ length: l.returnable }, (_, i) => `<option>${i + 1}</option>`).join("")}</select>
      </label>`,
    )
    .join("");
  $("[data-return-error]").hidden = true;
  $("[data-return-form]").hidden = false;
  $("[data-return-form]").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function submitReturn(e: SubmitEvent) {
  e.preventDefault();
  if (!current) return;
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  const lines = data.getAll("line").map((id) => ({ order_line: Number(id), quantity: Number(data.get(`qty-${id}`) ?? 1) }));
  const error = $("[data-return-error]");
  if (!lines.length) {
    error.textContent = "Choose at least one piece.";
    error.hidden = false;
    return;
  }
  try {
    await requestReturn(current.id, lines, String(data.get("reason")), String(data.get("note") ?? ""));
    form.reset();
    renderOrder(await getOrder(current.id));
    const note = document.querySelector<HTMLElement>("[data-order-error]")!;
    note.className = "notice";
    note.textContent = "Return requested. Pack the pieces with their labels and send them back: we refund them as soon as they arrive.";
    note.hidden = false;
    loadLists();
  } catch (err) {
    error.textContent = err instanceof ApiError ? err.message : "The return could not be requested. Try again.";
    error.hidden = false;
  }
}

async function cancelCurrent() {
  if (!current || !confirm("Cancel this order? Anything you paid is refunded in full.")) return;
  try {
    renderOrder(await cancelOrder(current.id));
    loadLists();
  } catch (err) {
    const el = document.querySelector<HTMLElement>("[data-order-error]")!;
    el.textContent = err instanceof ApiError ? err.message : "The order could not be cancelled.";
    el.hidden = false;
  }
}

async function loadLists() {
  const [o, r] = await Promise.all([myOrders(), myReturns()]);
  orders = o;
  $("[data-orders]").innerHTML = orders.map(orderRow).join("");
  $("[data-orders-empty]").hidden = orders.length > 0;
  $("[data-returns]").innerHTML = r.map(returnRow).join("");
  $("[data-returns-empty]").hidden = r.length > 0;
}

function showList() {
  current = null;
  $("[data-order]").hidden = true;
  document.querySelector<HTMLElement>("[data-signed-in]")!.hidden = false;
  history.replaceState(null, "", location.pathname);
}

async function render() {
  const signedIn = isSignedIn();
  $("[data-signed-out]").hidden = signedIn;
  document.querySelector<HTMLElement>("[data-signed-in]")!.hidden = !signedIn;
  $("[data-order]").hidden = true;
  if (!signedIn) return;
  try {
    const user = await me();
    $("[data-name]").textContent = user.first_name || user.email.split("@")[0];
    await loadLists();
    const id = Number(new URLSearchParams(location.search).get("order"));
    if (id) renderOrder(orders.find((o) => o.id === id) ?? (await getOrder(id)));
  } catch {
    // Session expired: the client signed out and fired auth-change
  }
}

export function initAccount() {
  initAuthForms();
  window.addEventListener("auth-change", render);
  $("[data-sign-out]").addEventListener("click", () => signOut());
  $("[data-back]").addEventListener("click", showList);
  $("[data-orders]").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-open]");
    const o = orders.find((x) => x.id === Number(row?.dataset.open));
    if (!o) return;
    history.replaceState(null, "", `?order=${o.id}`);
    renderOrder(o);
  });
  $("[data-order-body]").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-start-return]")) startReturn();
    if (t.closest("[data-cancel]")) cancelCurrent();
  });
  $<HTMLFormElement>("[data-return-form]").addEventListener("submit", submitReturn);
  $("[data-return-cancel]").addEventListener("click", () => ($("[data-return-form]").hidden = true));
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    }),
  );
  render();
}
