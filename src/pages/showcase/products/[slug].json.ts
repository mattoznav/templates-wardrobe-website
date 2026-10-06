/**
 * Showcase mode only: one product as `GET /api/products/<slug>/` returns it,
 * read by the product page for live stock. Nothing is emitted in a normal build.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { catalog } from "../../../lib/catalog";
import type { Product } from "../../../lib/types";

export const getStaticPaths = (async () => {
  if (import.meta.env.PUBLIC_SHOWCASE !== "true") return [];
  const { products } = await catalog();
  return products.map((product) => ({ params: { slug: product.slug }, props: { product } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify((props as { product: Product }).product), { headers: { "Content-Type": "application/json" } });
