module.exports = {
  apps: [
    {
      name: 'quickmarket-api',
      cwd: __dirname,
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
