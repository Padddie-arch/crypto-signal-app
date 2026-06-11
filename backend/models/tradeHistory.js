const trades = [];
const MAX_HISTORY = 200;
function add(signal) {
  trades.push(signal);
  if (trades.length > MAX_HISTORY) trades.shift();
}
function getAll() {
  return trades;
}
module.exports = { add, getAll };
