# Wardrobe template: Website

The public website of the clothing store: an editorial home page, the catalogue with filters, product pages with live stock, collections, bag, checkout with payment, and an account for orders, cancellations and returns.

Astro, no UI framework. Part of the [`templates-wardrobe`](https://github.com/mattoznav/templates-wardrobe) template, inside the [`templates`](https://github.com/mattoznav/templates) collection.

## Quick start

The website needs the [backend](https://github.com/mattoznav/templates-wardrobe-backend) running, by default on `http://localhost:8001`.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4322`.

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

## Credits

Fonts: Cormorant Garamond and Instrument Sans (SIL Open Font License). Icons: [Phosphor](https://phosphoricons.com) (MIT).
