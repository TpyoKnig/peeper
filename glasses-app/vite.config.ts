import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 5173 },
  // The public build is served by `vite preview` behind the Cloudflare tunnel (gateway/TUNNEL.md).
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, allowedHosts: ['g2.example.com'] },
  build: { target: 'esnext' },
})
