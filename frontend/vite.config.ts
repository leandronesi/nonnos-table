import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Su GitHub Pages il sito vive sotto /<repo>/, quindi gli asset vanno prefissati.
// In CI passiamo VITE_BASE='/mygotham/'. In dev locale lasciamo '/'.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173, open: true },
});
