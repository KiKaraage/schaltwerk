import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ command }) => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Ensure built asset paths work when loaded from filesystem in the Tauri bundle
  base: command === 'build' ? './' : '/',
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: parseInt(process.env.VITE_PORT || "1420"),
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and worktrees
      ignored: ["**/src-tauri/**", "**/.para/worktrees/**"],
    },
  },
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'xterm-vendor': ['xterm', 'xterm-addon-fit'],
          'ui-vendor': ['clsx', 'react-icons', 'react-split'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
    reportCompressedSize: false,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'xterm', 'xterm-addon-fit'],
  },
}));
