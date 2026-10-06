/**
 * Showcase mode only (PUBLIC_SHOWCASE=true): the data the in-browser backend
 * (src/lib/showcase.ts) needs to price bags and place orders, taken from the
 * API at build time. Nothing is emitted in a normal build.
 */
import type { APIRoute } from "astro";
import { catalog } from "../../lib/catalog";
import type { Snapshot } from "../../lib/types";

export function getStaticPaths() {
  return import.meta.env.PUBLIC_SHOWCASE === "true" ? [{ params: { file: "catalog" } }] : [];
}

export const GET: APIRoute = async () => {
  const { store, shipping, products, colours, sizes } = await catalog();
  const snapshot: Snapshot = {
    store,
    shipping,
    colours: Object.fromEntries(colours.map((c) => [c.slug, c.name])),
    sizes: Object.fromEntries(sizes.map((s) => [s.code, s.label])),
    products: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      price: p.price,
      compare_at_price: p.compare_at_price,
      variants: p.variants.map((v) => [v.id, v.sku, v.colour, v.size, v.stock]),
      images: Object.fromEntries(
        [...p.images].reverse().map((i) => [i.colour ?? "", i.url]).concat(p.images[0] ? [["", p.images[0].url]] : []),
      ),
    })),
  };
  return new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } });
};
