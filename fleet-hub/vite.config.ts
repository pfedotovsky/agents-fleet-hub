import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so one build serves both the Tauri desktop shell
  // (loaded from tauri://localhost/) and fleet-server hosting the UI under the
  // /fleet-hub/ sub-path. Absolute "/assets/..." would 404 under a sub-path.
  base: './',
  plugins: [react(), tailwindcss()],
})
