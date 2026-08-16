import { defineConfig } from "vite";
import { resolve } from "node:path";

// Site multi-pages : chaque page HTML est une entrée. Vite bundle un module
// TS par page — plus de 16 <script> globaux chargés partout.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/pages/index.html"),
        vehicules: resolve(__dirname, "src/pages/vehicules.html"),
        suites: resolve(__dirname, "src/pages/suites.html"),
        client: resolve(__dirname, "src/pages/client.html"),
        contact: resolve(__dirname, "src/pages/contact.html"),
        login: resolve(__dirname, "src/pages/login.html"),
        admin: resolve(__dirname, "src/pages/admin.html")
      }
    }
  }
});
