const axios = require('axios');

async function sendPushForSignals(signals) {
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) return;

  // Only notify if at least one signal has 7+ out of 11 strategies aligned
  const highAlignSignals = signals.filter(s => {
    const aligned = s.aligned || 0;
    const total = s.totalStrategies || 11;
    return aligned >= 7 && total === 11;
  });

  if (highAlignSignals.length === 0) return;

  // Build a message listing the top signals
  const top = highAlignSignals.slice(0, 3).map(s => `${s.pair} ${s.direction} (${s.aligned}/10)`).join(', ');
  const contents = { en: `🔥 ${highAlignSignals.length} strong signal(s): ${top}` };
  const headings = { en: 'High‑Confidence Signal Alert' };

  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ['All'],
      contents,
      headings,
      data: { type: 'strong_signals' }
    }, {
      headers: { Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}` }
    });
  } catch (err) {
    console.error('Push notification error:', err.response?.data || err.message);
  }
}

module.exports = { sendPushForSignals };
