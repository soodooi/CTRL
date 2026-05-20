import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ctrlapplab.com",
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
});
