module.exports = {
  apps: [
    {
      name: 'kgrcet-hackathon',
      script: 'server/server.mjs',
      node_args: '--env-file-if-exists=.env',
      instances: 1, // Single instance recommended for native SQLite WAL mode
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
}
