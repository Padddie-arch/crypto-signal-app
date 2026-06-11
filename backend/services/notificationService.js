const axios = require('axios');
async function sendPushForSignals(signals) {
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) return;
  const highConfSignals = signals.filter(s => s.confidence && s.confidence >= 80);
  if (highConfSignals.length === 0) return;
  const contents = { en: `${highConfSignals.length} high-confidence signals detected!` };
  const headings = { en: 'ðŸ”” New Trading Signals' };
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ['All'],
      contents,
      headings,
      data: { type: 'signals' }
    }, {
      headers: { Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}` }
    });
  } catch (err) {
    console.error('Push notification error:', err.response?.data || err.message);
  }
}
module.exports = { sendPushForSignals };
