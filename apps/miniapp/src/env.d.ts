/// <reference types="@dcloudio/types" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_REWARD_AD_UNIT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
