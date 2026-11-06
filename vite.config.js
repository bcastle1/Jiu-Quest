import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  // Unity owns this source tree and locks its cache during builds. Vite serves
  // the generated player from public/unity, without watching Editor internals.
  server: { watch: { ignored: ["**/unity/JiuQuestCombat/**"] } },
});
