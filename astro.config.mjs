import { defineConfig } from "astro/config";

export default defineConfig({
  // Replace with the shop's real domain before going live
  site: "https://shop.example.com",
  server: { port: 4322 },
  // Keep demos clean when showing the template
  devToolbar: { enabled: false },
});
