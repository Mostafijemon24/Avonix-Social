/**
 * PM2 process file — start from repo root:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "avonix-api",
      cwd: "/var/www/avonix-social/backend",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "400M",
      time: true,
    },
    {
      name: "avonix-web",
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
