import { defineConfig } from "vite";
import uniModule from "@dcloudio/vite-plugin-uni";

const uni = typeof uniModule === "function" ? uniModule : (uniModule as unknown as { default: typeof uniModule }).default;

export default defineConfig({
  plugins: [uni()]
});
