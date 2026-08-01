/**
 * TMA DevKit — TypeScript declarations for the mock script.
 *
 * Add to your project:
 *   <script src="node_modules/tma-devkit/tma-devkit.js"></script>
 *
 * The script is inert unless a #tma_devkit= config is present.
 */

declare global {
  interface Window {
    /** Resolves when the mock environment has been fully applied (initData signed, WebApp built). */
    __tmaDevkitReady: Promise<void>;
  }
}

export {};