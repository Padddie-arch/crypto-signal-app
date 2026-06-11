module.exports = {
  apps: [{
    name: 'crypto-backend',
    script: 'server.js',
    cwd: './backend',
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
};
