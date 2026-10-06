import { defineConfig } from "astro/config";

export default defineConfig({
  // Replace with the shop's real domain before going live. The GitHub Pages workflow
  // sets SITE_URL and BASE_PATH to publish the showcase under the repository's path.
  site: process.env.SITE_URL ?? "https://shop.example.com",
  base: process.env.BASE_PATH || "/",
  server: { port: 4322 },
  // Keep demos clean when showing the template
  devToolbar: { enabled: false },
});
