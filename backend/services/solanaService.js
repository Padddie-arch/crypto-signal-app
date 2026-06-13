const axios = require('axios');

// Use free CoinGecko API to discover new Solana meme coins
async function findNewSolanaMemeCoins() {
  // Wait 3 seconds to avoid rate limiting (important on free Render)
  await new Promise(resolve => setTimeout(resolve, 3000));
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        category: 'solana-ecosystem',
        order: 'market_cap_desc',
        per_page: 10,
        page: 1
      }
    });
    const coins = res.data;
    // Filter for meme-like names (very basic)
    const memeKeywords = ['meme', 'dog', 'cat', 'pepe', 'woof', 'inu', 'shib', 'bonk', 'wif'];
    const memeCoins = coins
      .filter(c =>
        memeKeywords.some(kw => c.name.toLowerCase().includes(kw) || c.symbol.toLowerCase().includes(kw))
      )
      .map(c => ({
        name: c.name,
        symbol: c.symbol,
        price: c.current_price,
        marketCap: c.market_cap,
        volume24h: c.total_volume,
        priceChange24h: c.price_change_percentage_24h,
        probability: Math.min(
          85,
          30 +
            (c.price_change_percentage_24h > 5 ? 30 : 10) +
            (c.total_volume > 1e6 ? 20 : 0)
        )
      }));
    return memeCoins;
  } catch (err) {
    console.error('Solana meme coin error:', err.message);
    return [];
  }
}

module.exports = { findNewSolanaMemeCoins };
