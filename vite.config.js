import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fontPreload from "./tools/vite_font_preload.mjs";

export default defineConfig({
  // fontPreload adds the heading typeface to the built index.html, so a first
  // visit starts downloading it with the page. It does nothing in the dev server.
  plugins: [react(), fontPreload()],
  base: "/",
  // The app has one HTML entry. Do not scan ignored vendor/demo HTML trees.
  optimizeDeps: { entries: ["index.html"] },
  // Both Editors lock their caches and crash dumps. Their generated assets are
  // served separately; neither Editor internals nor the local SDK need HMR.
  server: { watch: { ignored: ["**/unity/JiuQuestCombat/**", "**/unreal/JiuQuestCharacters/**", "**/tmp/**"] } },
});
