/**
 * PM2 — Avonix Social ONLY
 *
 * Matches live Apache proxy on this VPS:
 *   avonixai.com        → 127.0.0.1:3002  (Avonix AI — separate PM2 app)
 *   social.avonixai.com → 127.0.0.1:3000  (this web app)
 *   Social API          → 127.0.0.1:4000  (this API)
 *
 * From /var/www/avonix-social:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "avonix-social-api",
      cwd: "/var/www/avonix-social/backend",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        HOST: "127.0.0.1",
      },
      max_memory_restart: "400M",
      time: true,
    },
    {
      name: "avonix-social-web",
      cwd: "/var/www/avonix-social",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        API_SERVER_URL: "http://127.0.0.1:4000",
      },
      max_memory_restart: "600M",
      time: true,
    },
  ],
};
