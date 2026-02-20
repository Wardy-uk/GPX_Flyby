/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_OS_API_KEY?: string;
  readonly VITE_OS_RASTER_LAYER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}