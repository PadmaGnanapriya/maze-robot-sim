/// <reference types="vite/client" />

// `?raw` imports of the default sketch (see src/sim/SimController.ts).
declare module '*.ino?raw' {
  const src: string;
  export default src;
}
declare module '*.h?raw' {
  const src: string;
  export default src;
}
