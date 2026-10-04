/**
 * Product page: colour and size pickers, live stock and "Add to bag".
 * The page is built with the stock of build time; the live stock is fetched
 * on load so sizes that sold out since then are disabled.
 */
import { addToBag } from "../lib/bag";
import { product as fetchProduct } from "../lib/client";
import type { Variant } from "../lib/types";
import { openDrawer } from "./bag-ui";

interface PageProduct {
  slug: string;
  name: string;
  price: string;
  variants: Variant[];
  images: { url: string; colour: string | null }[];
}

const LOW_STOCK = 3;

export function initProduct() {
  const root = document.querySelector<HTMLElement>("[data-product]")!;
  const data: PageProduct = JSON.parse(root.dataset.product!);
  const colourButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-colour]")].filter((b) => b.classList.contains("colour"));
  const sizeButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-size]")];
  const add = root.querySelector<HTMLButtonElement>("[data-add]")!;
  const stockNote = root.querySelector<HTMLElement>("[data-stock]")!;
  const error = root.querySelector<HTMLElement>("[data-add-error]")!;
  const gallery = root.querySelector<HTMLElement>("[data-gallery]")!;
  const oneSize = sizeButtons.length === 1 && sizeButtons[0].dataset.size === "one-size";

  let variants = data.variants;
  let colour = colourButtons[0]?.dataset.colour ?? "";
  let size = oneSize ? "one-size" : "";

  const variantFor = (c: string, s: string) => variants.find((v) => v.colour === c && v.size === s);

  function render() {
    colourButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.colour === colour)));
    root.querySelector("[data-colour-name]")!.textContent = colourButtons.find((b) => b.dataset.colour === colour)?.dataset.name ?? "";

    let soldOut = 0;
    sizeButtons.forEach((b) => {
      const v = variantFor(colour, b.dataset.size!);
      const stock = v?.stock ?? 0;
      b.disabled = stock <= 0;
      b.toggleAttribute("data-low", stock > 0 && stock <= LOW_STOCK);
      b.setAttribute("aria-checked", String(b.dataset.size === size));
      b.title = stock <= 0 ? "Sold out" : stock <= LOW_STOCK ? `Only ${stock} left` : "";
      if (stock <= 0) soldOut++;
    });
    root.querySelector("[data-size-note]")!.textContent = soldOut === sizeButtons.length ? "Sold out in this colour" : "";

    const selected = size ? variantFor(colour, size) : undefined;
    if (selected && selected.stock <= 0) size = "";
    const stock = selected?.stock ?? 0;
    if (!size) {
      add.disabled = !oneSize;
      add.textContent = "Select a size";
      stockNote.textContent = "";
    } else if (stock <= 0) {
      add.disabled = true;
      add.textContent = "Sold out";
      stockNote.textContent = "";
    } else {
      add.disabled = false;
      add.textContent = "Add to bag";
      stockNote.textContent = stock <= LOW_STOCK ? `Only ${stock} left in this size.` : "In stock, ready to ship.";
      stockNote.dataset.tone = stock <= LOW_STOCK ? "low" : "";
    }
  }

  /** Put the photos of the chosen colour first. */
  function showColour() {
    const items = [...gallery.children] as HTMLElement[];
    const first = items.find((i) => i.dataset.colour === colour);
    if (first && first !== items[0]) {
      gallery.prepend(first);
      if (gallery.scrollWidth > gallery.clientWidth) gallery.scrollTo({ left: 0, behavior: "smooth" });
    }
  }

  colourButtons.forEach((b) =>
    b.addEventListener("click", () => {
      colour = b.dataset.colour!;
      showColour();
      render();
    }),
  );

  sizeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      size = b.dataset.size!;
      error.hidden = true;
      render();
    }),
  );

  add.addEventListener("click", () => {
    const v = variantFor(colour, size);
    if (!v || v.stock <= 0) return;
    const image = data.images.find((i) => i.colour === colour) ?? data.images[0];
    addToBag({
      variant: v.id,
      slug: data.slug,
      name: data.name,
      colour: root.querySelector("[data-colour-name]")!.textContent ?? "",
      size: sizeButtons.find((b) => b.dataset.size === size)?.textContent?.trim() ?? size,
      image: image?.url ?? "",
      price: data.price,
    });
    openDrawer(true);
  });

  render();

  // Live stock
  fetchProduct(data.slug)
    .then((live) => {
      variants = live.variants;
      data.price = live.price;
      render();
    })
    .catch(() => {
      // Offline or backend down: keep the build-time stock, checkout checks again
    });
}
