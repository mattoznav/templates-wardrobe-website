/** The bag page: lines from the browser, prices and stock confirmed by the API. */
import { bagCount, bagLines, readBag, type BagItem } from "../lib/bag";
import { quote } from "../lib/client";
import { money } from "../lib/format";
import { bindLineControls, lineMarkup } from "./bag-ui";
import { esc } from "./html";

export function initBagPage() {
  const root = document.querySelector<HTMLElement>("[data-bag-page]")!;
  const list = root.querySelector<HTMLElement>("[data-bag-lines]")!;
  const currency = document.documentElement.dataset.currency ?? "EUR";
  let request = 0;

  async function render(items: BagItem[]) {
    const n = bagCount(items);
    root.querySelector("[data-bag-summary]")!.textContent = n ? `${n} ${n === 1 ? "piece" : "pieces"}` : "";
    root.querySelector<HTMLElement>("[data-bag-full]")!.hidden = items.length === 0;
    root.querySelector<HTMLElement>("[data-bag-empty]")!.hidden = items.length > 0;
    list.innerHTML = items.map((i) => lineMarkup(i)).join("");
    const subtotal = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
    root.querySelector("[data-subtotal]")!.textContent = money(subtotal, currency);
    if (!items.length) return;

    const mine = ++request;
    try {
      const q = await quote(bagLines(items), "standard");
      if (mine !== request) return; // a newer change is already being priced
      root.querySelector("[data-subtotal]")!.textContent = money(q.subtotal, q.currency);
      root.querySelector("[data-shipping]")!.textContent = Number(q.shipping) ? money(q.shipping, q.currency) : "Free";
      root.querySelector("[data-total]")!.textContent = money(q.total, q.currency);
      for (const line of q.lines) {
        const el = list.querySelector<HTMLElement>(`[data-variant="${line.variant}"] [data-problem]`);
        if (!el) continue;
        const short = line.available < line.quantity;
        el.hidden = !short;
        el.textContent = line.available ? `Only ${line.available} left: lower the quantity to continue.` : "Sold out: remove it to continue.";
      }
      const problems = root.querySelector<HTMLElement>("[data-problems]")!;
      problems.hidden = q.problems.length === 0;
      problems.innerHTML = q.problems.map((p) => `<li>${esc(p)}</li>`).join("");
      root.querySelector<HTMLAnchorElement>("[data-checkout]")!.toggleAttribute("aria-disabled", q.problems.length > 0);
      root.querySelector<HTMLAnchorElement>("[data-checkout]")!.style.pointerEvents = q.problems.length ? "none" : "";
      root.querySelector<HTMLAnchorElement>("[data-checkout]")!.style.opacity = q.problems.length ? "0.4" : "";
    } catch {
      root.querySelector("[data-shipping]")!.textContent = "Calculated at checkout";
      root.querySelector("[data-total]")!.textContent = money(subtotal, currency);
    }
  }

  bindLineControls(list);
  window.addEventListener("bag-change", (e) => render((e as CustomEvent<BagItem[]>).detail));
  render(readBag());
}
