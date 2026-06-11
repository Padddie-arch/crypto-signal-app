import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import SignalCard from '../components/SignalCard';

export default function HomeScreen({ navigation, signals, memeCoins }) {
  const [autoTrade, setAutoTrade] = useState(false);
  const toggleAutoTrade = async (val) => {
    setAutoTrade(val);
    await fetch('https://your-backend-url.onrender.com/api/autotrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.autoTradeRow}>
        <Text style={styles.autoText}>Auto Trade</Text>
        <Switch value={autoTrade} onValueChange={toggleAutoTrade} trackColor={{ false: '#555', true: '#00c853' }} />
      </View>
      <Text style={styles.sectionTitle}>ðŸ”¥ High Confidence Signals</Text>
      <FlatList
        data={signals.sort((a,b) => b.confidence - a.confidence)}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => <SignalCard signal={item} onChartPress={() => navigation.navigate('Chart', { symbol: item.symbol })} />}
      />
      {memeCoins.length > 0 && (
        <View style={styles.memeSection}>
          <Text style={styles.memeTitle}>ðŸ¶ New Solana Meme Coins</Text>
          {memeCoins.map(coin => (
            <View key={coin.symbol} style={styles.memeItem}>
              <Text style={styles.memeText}>{coin.name} ({coin.symbol}) - ${coin.price.toFixed(6)} | Prob: {coin.probability}%</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', paddingTop: 10 },
  autoTradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#1a1a2e', marginBottom: 10 },
  autoText: { color: '#fff', fontSize: 16 },
  sectionTitle: { color: '#ffaa00', fontSize: 20, fontWeight: 'bold', marginLeft: 15, marginBottom: 10 },
  memeSection: { padding: 15, backgroundColor: '#16213e', marginTop: 10 },
  memeTitle: { color: '#ff66aa', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  memeItem: { paddingVertical: 5 },
  memeText: { color: '#ddd', fontSize: 14 }
});
