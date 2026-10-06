# Wardrobe template: Website

The public website of the clothing store: an editorial home page, the catalogue with filters, product pages with live stock, collections, bag, checkout with payment, and an account for orders, cancellations and returns.

Astro, no UI framework. Part of the [`templates-wardrobe`](https://github.com/mattoznav/templates-wardrobe) template, inside the [`templates`](https://github.com/mattoznav/templates) collection.

Live demo: [mattoznav.github.io/templates-wardrobe-website](https://mattoznav.github.io/templates-wardrobe-website/), a static showcase that runs without the backend (see [Showcase mode](#showcase-mode)).

## Requirements

- Node.js 22.12 or newer and npm
- The backend running locally (see its README)

## Quick start

The website needs the [backend](https://github.com/mattoznav/templates-wardrobe-backend) running, by default on `http://localhost:8001`.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4322`.

Check types and templates with `npm run check`; `npm run build` produces the static site in `dist/`.

## What is static and what is live

| Part | When it is loaded |
| --- | --- |
| Home, catalogue, product pages, collections, store and atelier pages | At build time, from the API. Rebuild after editing products in the admin |
| Stock per size, bag prices, shipping, problems such as "only 1 left" | Live, in the browser |
| Account, orders, payments, returns | Live, in the browser |

So the pages are fast and cacheable, while stock is always current. In development the build-time data refreshes every few seconds, so admin edits show up on reload.

## Pages

| Path | What it does |
| --- | --- |
| `/` | Hero, new in, departments, the featured edit, knitwear story, collections, atelier, store |
| `/shop/` | Every product, filtered in the browser: `section`, `category`, `colour`, `size`, `new`, `sale`, `sort`. Filters live in the URL |
| `/products/<slug>/` | Photos per colour, colour and size pickers with live stock, add to bag, details, care, credits, complete the look |
| `/collections/`, `/collections/<slug>/` | Curated edits |
| `/bag/` | Quantities, today's prices and stock, standard shipping, free shipping threshold |
| `/checkout/` | Sign in, delivery address and method, then payment while the pieces are set aside. `?order=<id>` resumes a pending payment |
| `/account/` | Orders with their progress, cancel before shipping, request a return; returns and their status |
| `/store/`, `/about/` | The physical store, services and delivery; the atelier and a care guide |

The bag lives in the browser (`localStorage`) until checkout, so no account is needed to fill it. Prices and stock are always checked again by the backend before paying.

## Payments

The website follows whatever the backend uses:

- **Fake provider** (default): a demo panel with "Pay" and "Simulate a declined card". No money moves.
- **Stripe**: the Stripe Payment Element is loaded on demand and the page waits for the backend webhook to mark the order paid. Use test mode keys and [test cards](https://docs.stripe.com/testing).

## Photos

Product and editorial photos are from [Unsplash](https://unsplash.com), under the [Unsplash License](https://unsplash.com/license). They are loaded from the Unsplash CDN with the size and crop each layout needs (`src/lib/image.ts`), and every page credits the photographers.

## Customising

- Colours, fonts and shapes are design tokens at the top of `src/styles/global.css`.
- The shop name, address, opening hours, free shipping amount and return window come from the backend (`data/store.csv`); home page copy and images from `data/editorial.csv`.
- Set the real domain in `astro.config.mjs` (`site`).
- Links to pages and files in `public/` go through `withBase()` from `src/lib/paths.ts`, so the site also works under a sub-path.

## Showcase mode

A static host such as GitHub Pages cannot run the Django backend, so the website can be built as a self-contained showcase: set `PUBLIC_SHOWCASE=true` at build time. Without it nothing changes and none of the showcase code is shipped.

| Part | Where it comes from in showcase mode |
| --- | --- |
| Pages, catalogue, collections | The backend API at build time, as usual |
| Snapshot for the browser | `src/pages/showcase/` writes `showcase/catalog.json` (store settings, shipping methods, products with their variants and stock) and one `showcase/products/<slug>.json` per product |
| Every API call made in the browser | `src/lib/showcase.ts`, loaded by `src/lib/client.ts` instead of calling the network |

`src/lib/showcase.ts` answers the same endpoints with the same shapes, status codes and error messages as the backend, and applies the same rules: prices and free delivery, stock set aside for 15 minutes while paying and released if the payment does not arrive, the fake payment provider (paid or declined), cancellation before shipping with a refund, the return window and returnable quantities. Accounts, sign-in tokens, orders, payments, returns and the stock the visitor bought are stored in this browser only (`localStorage`, key `wardrobe.showcase`); passwords are kept as salted SHA-256 hashes. Pieces the visitor buys lower the stock shown on the product pages.

The back office is not there, so its part is simulated: a paid order ships 3 minutes after payment and is delivered 3 minutes later, and a requested return is received and refunded 3 minutes after it is sent. The timings are at the top of `src/lib/showcase.ts`. The layout shows a slim notice explaining that the site is a showcase.

## Publish on GitHub Pages

`.github/workflows/pages.yml` builds the showcase and publishes it on GitHub Pages at every push to `main`, once a day (so the catalogue follows the backend's data) and on demand. The job checks out the [backend](https://github.com/mattoznav/templates-wardrobe-backend), loads its catalogue with `manage.py bootstrap --no-demo-orders` and runs it on `localhost:8001` only for the build; the published site never calls it.

To use it in a copy of the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**. If the backend lives in another repository, change the second checkout step. The workflow passes the Pages address to the build through `SITE_URL` and `BASE_PATH`, so the site works under `https://<user>.github.io/<repository>/`; with a custom domain the path is simply `/`.

To try the showcase locally, with the backend running:

```bash
PUBLIC_SHOWCASE=true npm run build
npx astro preview
```

## Structure

```
src/pages/             Home, shop, product, collections, bag, checkout, account, store, atelier
src/pages/showcase/    Snapshots for showcase mode (emitted only with PUBLIC_SHOWCASE=true)
src/components/        Header, footer, bag drawer, product card, sign-in form, showcase notice
src/layouts/Base.astro Page shell
src/scripts/           Browser code for each page: filters, stock, bag, checkout, account
src/lib/catalog.ts     Build-time data from the API
src/lib/client.ts      Browser API client: stock, bag quote, accounts, orders, payments, returns
src/lib/showcase.ts    The backend simulated in the browser, for showcase mode
src/lib/paths.ts       withBase(), for links that must follow the site's base path
src/styles/global.css  Design tokens and shared styles
.github/workflows/     GitHub Pages deployment
```

## Credits

Fonts: Cormorant Garamond and Instrument Sans (SIL Open Font License). Icons: [Phosphor](https://phosphoricons.com) (MIT).

## License

The code is released under the [MIT License](LICENSE). Product photos are not part of the repository: they are loaded from Unsplash under the [Unsplash License](https://unsplash.com/license).
