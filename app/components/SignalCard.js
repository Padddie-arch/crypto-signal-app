import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function SignalCard({ signal, onChartPress }) {
  const isBuy = signal.direction === 'BUY';
  return (
    <TouchableOpacity onPress={onChartPress} style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[styles.pair, { color: isBuy ? '#00e676' : '#ff5252' }]}>{signal.pair} {signal.direction}</Text>
        <Text style={styles.timeframe}>{signal.timeframe}</Text>
      </View>
      <Text style={styles.price}>Price: ${signal.price?.toFixed(2)}</Text>
      <Text style={styles.confidence}>Confidence: {signal.confidence}%</Text>
      {signal.rsi && <Text style={styles.info}>RSI: {signal.rsi.toFixed(1)} | MACD: {signal.macd.toFixed(4)}</Text>}
      <Text style={styles.info}>SL: ${signal.stopLoss?.toFixed(2)} | TP: ${signal.takeProfit?.toFixed(2)}</Text>
      <Text style={styles.info}>Trailing Stop: ${signal.trailingStop?.toFixed(2)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1a1a2e', padding: 15, marginHorizontal: 10, marginVertical: 5, borderRadius: 10, borderLeftWidth: 5, borderLeftColor: '#ffaa00' },
  pair: { fontSize: 18, fontWeight: 'bold' },
  timeframe: { color: '#aaa', fontSize: 14 },
  price: { color: '#fff', fontSize: 16, marginTop: 5 },
  confidence: { color: '#ffaa00', fontSize: 15, fontWeight: 'bold' },
  info: { color: '#ccc', fontSize: 13, marginTop: 2 }
});
