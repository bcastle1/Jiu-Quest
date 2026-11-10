import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  // The app has one HTML entry. Do not scan ignored vendor/demo HTML trees.
  optimizeDeps: { entries: ["index.html"] },
  // Both Editors lock their caches and crash dumps. Their generated assets are
  // served separately; neither Editor internals nor the local SDK need HMR.
  server: { watch: { ignored: ["**/unity/JiuQuestCombat/**", "**/unreal/JiuQuestCharacters/**", "**/tmp/**"] } },
});
