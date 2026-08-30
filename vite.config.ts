import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: ["sleep.mp4"],

      manifest: {
        name: "Sleepy",
        short_name: "Sleepy",

        description:
          "Sleep and feeding tracker for the little ones.",

        theme_color: "#17131f",
        background_color: "#17131f",

        display: "standalone",

        start_url: "/",

        orientation: "portrait-primary",

        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp}",
        ],
      },
    }),
  ],
});