/**
 * Filters the product grid in the browser. Every product is already on the
 * page (the catalogue is small); the state lives in the URL so filtered views
 * can be shared and survive the back button.
 */

const TITLES: Record<string, [string, string]> = {
  "": ["The collection", "Shop all"],
  women: ["Shop", "Women"],
  men: ["Shop", "Men"],
  accessories: ["Bags, shoes and the rest", "Accessories"],
};

interface State {
  section: string;
  category: string;
  colours: string[];
  sizes: string[];
  isNew: boolean;
  sale: boolean;
  sort: string;
  q: string;
}

function readState(): State {
  const p = new URLSearchParams(location.search);
  return {
    section: p.get("section") ?? "",
    category: p.get("category") ?? "",
    colours: p.getAll("colour"),
    sizes: p.getAll("size"),
    isNew: p.get("new") === "1",
    sale: p.get("sale") === "1",
    sort: p.get("sort") ?? "featured",
    q: (p.get("q") ?? "").toLowerCase(),
  };
}

function writeState(s: State) {
  const p = new URLSearchParams();
  if (s.section) p.set("section", s.section);
  if (s.category) p.set("category", s.category);
  s.colours.forEach((c) => p.append("colour", c));
  s.sizes.forEach((c) => p.append("size", c));
  if (s.isNew) p.set("new", "1");
  if (s.sale) p.set("sale", "1");
  if (s.sort !== "featured") p.set("sort", s.sort);
  if (s.q) p.set("q", s.q);
  const query = p.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

const SORTS: Record<string, (a: HTMLElement, b: HTMLElement) => number> = {
  featured: (a, b) => Number(b.dataset.popularity) - Number(a.dataset.popularity),
  newest: (a, b) => Number(b.dataset.new) - Number(a.dataset.new) || (b.dataset.created ?? "").localeCompare(a.dataset.created ?? ""),
  price_asc: (a, b) => Number(a.dataset.price) - Number(b.dataset.price),
  price_desc: (a, b) => Number(b.dataset.price) - Number(a.dataset.price),
};

function matches(card: HTMLElement, s: State): boolean {
  const d = card.dataset;
  if (s.section && d.section !== s.section && !(s.section !== "accessories" && d.department === "unisex" && d.section !== "accessories")) return false;
  if (s.category && d.category !== s.category) return false;
  const colours = (d.colours ?? "").split(" ");
  if (s.colours.length && !s.colours.some((c) => colours.includes(c))) return false;
  const sizes = (d.sizes ?? "").split(" ");
  if (s.sizes.length && !s.sizes.some((c) => sizes.includes(c))) return false;
  if (s.isNew && d.new !== "1") return false;
  if (s.sale && d.sale !== "1") return false;
  if (s.q && !(d.name ?? "").includes(s.q)) return false;
  return true;
}

export function initShop() {
  const root = document.querySelector<HTMLElement>("[data-shop]")!;
  const grid = root.querySelector<HTMLElement>("[data-grid]")!;
  const cards = [...grid.querySelectorAll<HTMLElement>("[data-product-card]")];
  const categoriesBySection: Record<string, string[]> = JSON.parse(root.dataset.categories ?? "{}");
  const filters = root.querySelector<HTMLElement>("[data-filters]")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-filter-toggle]")!;
  const sort = root.querySelector<HTMLSelectElement>("[data-sort]")!;
  let state = readState();

  function render() {
    const [eyebrow, title] = TITLES[state.section] ?? TITLES[""];
    root.querySelector("[data-shop-eyebrow]")!.textContent = state.isNew ? "Just arrived" : eyebrow;
    root.querySelector("[data-shop-title]")!.textContent = state.isNew ? `New in${state.section ? `: ${title}` : ""}` : title;
    document.title = `${state.isNew ? "New in" : title} | ${document.title.split(" | ").pop()}`;

    root.querySelectorAll<HTMLAnchorElement>("[data-section-tab]").forEach((tab) => {
      tab.toggleAttribute("aria-current", tab.dataset.sectionTab === state.section);
      if (tab.dataset.sectionTab === state.section) tab.setAttribute("aria-current", "page");
    });

    const available = categoriesBySection[state.section || "all"] ?? [];
    if (state.category && !available.includes(state.category)) state.category = "";
    root.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((chip) => {
      const slug = chip.dataset.category ?? "";
      chip.hidden = slug !== "" && !available.includes(slug);
      chip.setAttribute("aria-pressed", String(slug === state.category));
    });

    filters.querySelectorAll<HTMLInputElement>('input[name="colour"]').forEach((i) => (i.checked = state.colours.includes(i.value)));
    filters.querySelectorAll<HTMLInputElement>('input[name="size"]').forEach((i) => (i.checked = state.sizes.includes(i.value)));
    filters.querySelector<HTMLInputElement>('input[name="new"]')!.checked = state.isNew;
    filters.querySelector<HTMLInputElement>('input[name="sale"]')!.checked = state.sale;
    sort.value = state.sort;

    const active = state.colours.length + state.sizes.length + Number(state.isNew) + Number(state.sale);
    root.querySelector("[data-filter-count]")!.textContent = active ? `(${active})` : "";

    const visible = cards.filter((c) => matches(c, state)).sort(SORTS[state.sort] ?? SORTS.featured);
    cards.forEach((c) => (c.hidden = !visible.includes(c)));
    visible.forEach((c) => grid.append(c));
    root.querySelector("[data-count]")!.textContent = `${visible.length} ${visible.length === 1 ? "piece" : "pieces"}`;
    root.querySelector<HTMLElement>("[data-empty]")!.hidden = visible.length > 0;
    writeState(state);
  }

  root.querySelectorAll<HTMLAnchorElement>("[data-section-tab]").forEach((tab) =>
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      state = { ...state, section: tab.dataset.sectionTab ?? "", category: "" };
      render();
    }),
  );

  root.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((chip) =>
    chip.addEventListener("click", () => {
      state = { ...state, category: chip.dataset.category ?? "" };
      render();
    }),
  );

  toggle.addEventListener("click", () => {
    filters.hidden = !filters.hidden;
    toggle.setAttribute("aria-expanded", String(!filters.hidden));
  });

  filters.addEventListener("change", () => {
    const checked = (name: string) => [...filters.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);
    state = { ...state, colours: checked("colour"), sizes: checked("size"), isNew: checked("new").length > 0, sale: checked("sale").length > 0 };
    render();
  });

  sort.addEventListener("change", () => {
    state = { ...state, sort: sort.value };
    render();
  });

  root.querySelectorAll("[data-clear]").forEach((b) =>
    b.addEventListener("click", () => {
      state = { ...state, category: "", colours: [], sizes: [], isNew: false, sale: false, q: "" };
      render();
    }),
  );

  // Open the filter panel when the page is loaded with filters already set
  if (state.colours.length || state.sizes.length || state.sale) {
    filters.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }
  render();
}
