import { defineConfig } from "vite";
import { resolve } from "node:path";

// Site multi-pages : chaque page HTML à la racine est une entrée. Vite bundle un
// module TS par page + un chunk partagé — plus de 16 <script> globaux chargés partout.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        vehicules: resolve(__dirname, "vehicules.html"),
        suites: resolve(__dirname, "suites.html"),
        client: resolve(__dirname, "client.html"),
        contact: resolve(__dirname, "contact.html"),
        login: resolve(__dirname, "login.html"),
        admin: resolve(__dirname, "admin.html")
      }
    }
  }
});
