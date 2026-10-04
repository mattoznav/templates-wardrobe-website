/** Header count and slide-in bag, kept in sync with the bag in localStorage. */
import { bagCount, readBag, removeFromBag, setQuantity, type BagItem } from "../lib/bag";
import { money } from "../lib/format";
import { img } from "../lib/image";
import { esc } from "./html";

const currency = () => document.documentElement.dataset.currency ?? "EUR";

export function lineMarkup(item: BagItem): string {
  return `
    <li class="bag-line" data-variant="${item.variant}">
      <a class="bag-line__photo photo" href="/products/${esc(item.slug)}/">
        ${item.image ? `<img src="${img(item.image, 180, 240)}" alt="" loading="lazy" width="90" height="120" />` : ""}
      </a>
      <div class="bag-line__info">
        <a class="bag-line__name" href="/products/${esc(item.slug)}/">${esc(item.name)}</a>
        <p class="bag-line__meta">${esc(item.colour)} · ${esc(item.size)}</p>
        <div class="bag-line__qty" aria-label="Quantity">
          <button type="button" data-qty="-1" aria-label="One less">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-qty="1" aria-label="One more" ${item.quantity >= 10 ? "disabled" : ""}>+</button>
        </div>
        <p class="bag-line__problem" data-problem hidden></p>
      </div>
      <div class="bag-line__side">
        <span class="price">${money(Number(item.price) * item.quantity, currency())}</span>
        <button type="button" class="text-link" data-remove>Remove</button>
      </div>
    </li>`;
}

/** Quantity buttons and remove links inside any list of bag lines. */
export function bindLineControls(list: HTMLElement) {
  list.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const line = target.closest<HTMLElement>("[data-variant]");
    if (!line) return;
    const variant = Number(line.dataset.variant);
    const item = readBag().find((i) => i.variant === variant);
    if (!item) return;
    const step = target.closest<HTMLElement>("[data-qty]");
    if (step) setQuantity(variant, item.quantity + Number(step.dataset.qty));
    if (target.closest("[data-remove]")) removeFromBag(variant);
  });
}

function renderCount(items: BagItem[], bump = false) {
  document.querySelectorAll<HTMLElement>("[data-bag-count]").forEach((el) => {
    const n = bagCount(items);
    el.textContent = String(n);
    el.toggleAttribute("data-empty", n === 0);
    if (bump) {
      el.classList.add("is-bump");
      setTimeout(() => el.classList.remove("is-bump"), 300);
    }
  });
}

function renderDrawer(items: BagItem[]) {
  const drawer = document.querySelector<HTMLElement>("[data-drawer]");
  if (!drawer) return;
  const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  drawer.querySelector("[data-drawer-lines]")!.innerHTML = items.map((i) => lineMarkup(i)).join("");
  drawer.querySelector<HTMLElement>("[data-drawer-empty]")!.hidden = items.length > 0;
  drawer.querySelector<HTMLElement>("[data-drawer-foot]")!.hidden = items.length === 0;
  drawer.querySelector("[data-drawer-subtotal]")!.textContent = money(subtotal, currency());
  const n = bagCount(items);
  drawer.querySelector("[data-drawer-count]")!.textContent = n ? `(${n})` : "";

  const free = drawer.querySelector<HTMLElement>("[data-free-shipping]")!;
  const threshold = Number(free.dataset.freeShipping);
  free.hidden = !threshold;
  if (threshold) {
    const left = threshold - subtotal;
    free.querySelector("[data-free-text]")!.textContent =
      left > 0 ? `You are ${money(left, currency())} away from free delivery.` : "Your order ships for free.";
    free.querySelector<HTMLElement>("[data-free-bar]")!.style.width = `${Math.min(100, (subtotal / threshold) * 100)}%`;
  }
}

let lastFocus: HTMLElement | null = null;

export function openDrawer(added = false) {
  const drawer = document.querySelector<HTMLElement>("[data-drawer]");
  if (!drawer) return;
  lastFocus = document.activeElement as HTMLElement;
  renderDrawer(readBag());
  drawer.querySelector<HTMLElement>("[data-drawer-added]")!.hidden = !added;
  drawer.hidden = false;
  document.body.style.overflow = "hidden";
  drawer.querySelector<HTMLElement>("[data-drawer-panel]")!.focus();
}

function closeDrawer() {
  const drawer = document.querySelector<HTMLElement>("[data-drawer]");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.style.overflow = "";
  lastFocus?.focus();
}

export function initBagUi() {
  const items = readBag();
  renderCount(items);

  // On the bag and checkout pages the header button goes to the page instead
  const onBagPage = /^\/(bag|checkout)\//.test(location.pathname);
  document.querySelectorAll<HTMLElement>("[data-bag-open]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (onBagPage) return;
      e.preventDefault();
      openDrawer();
    }),
  );
  document.querySelectorAll<HTMLElement>("[data-drawer-close]").forEach((el) => el.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

  const list = document.querySelector<HTMLElement>("[data-drawer-lines]");
  if (list) bindLineControls(list);

  let previous = bagCount(items);
  window.addEventListener("bag-change", (e) => {
    const next = (e as CustomEvent<BagItem[]>).detail;
    renderCount(next, bagCount(next) > previous);
    previous = bagCount(next);
    renderDrawer(next);
  });
  // Another tab changed the bag
  window.addEventListener("storage", (e) => {
    if (e.key === "wardrobe.bag") {
      renderCount(readBag());
      renderDrawer(readBag());
    }
  });

  // Mark the shop section in the header (query strings are not known at build time)
  const section = new URLSearchParams(location.search).get("section");
  if (location.pathname.startsWith("/shop") && section) {
    document.querySelectorAll<HTMLAnchorElement>(".header__nav a").forEach((a) => {
      if (a.href.endsWith(`section=${section}`)) a.setAttribute("aria-current", "page");
    });
  }
}
