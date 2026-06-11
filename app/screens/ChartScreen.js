import React, { useEffect, useState } from 'react';
import { View, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import axios from 'axios';

export default function ChartScreen({ route }) {
  const { symbol } = route.params;
  const [data, setData] = useState({ labels: [], datasets: [{ data: [] }] });
  useEffect(() => {
    axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=20`)
      .then(res => {
        const closes = res.data.map(c => parseFloat(c[4]));
        const labels = res.data.map((_, i) => i.toString());
        setData({ labels, datasets: [{ data: closes }] });
      })
      .catch(err => console.error(err));
  }, [symbol]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f1a', justifyContent: 'center', alignItems: 'center' }}>
      <LineChart
        data={data}
        width={Dimensions.get('window').width - 20}
        height={300}
        chartConfig={{ backgroundColor: '#1a1a2e', backgroundGradientFrom: '#1a1a2e', backgroundGradientTo: '#16213e', color: (opacity = 1) => `rgba(0, 200, 255, ${opacity})`, labelColor: () => '#fff' }}
        bezier
      />
    </View>
  );
}
