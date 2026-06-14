const axios = require('axios');

let lastRequestTime = 0;
const MIN_GAP = 2500; // 2.5 seconds between all CoinGecko requests

// This function should be used for EVERY CoinGecko call
async function coinGeckoGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 15000 });
}

module.exports = { coinGeckoGet };
