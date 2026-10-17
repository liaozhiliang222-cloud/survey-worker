const base = require('./playwright.config.js');
const sourceServer = process.env.DRIVER_SOURCE_SERVER === '1';
const port = sourceServer ? 4294 : 4293;
module.exports = {
  ...base,
  testMatch: ['driver-analysis.spec.js', 'driver-lmg.spec.js'],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: sourceServer ? 'node server.js' : `npm run preview -- --host 127.0.0.1 --port ${port}`,
    env: sourceServer ? { PORT: String(port) } : {},
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
};
