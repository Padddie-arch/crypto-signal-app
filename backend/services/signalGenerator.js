        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction: consensus.direction,
          price: indicators.price,
          confidence: consensus.confidence,
          aligned: consensus.aligned,           // <-- new field
          totalActive: consensus.totalActive,   // <-- new field
          stopLoss: consensus.stopLoss,
          takeProfit: consensus.takeProfit,
          trailingStop: null,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          aiTrend: consensus.trend,
          adx: consensus.adx,
          trendStrength: consensus.trend,
          timestamp: consensus.timestamp
        };
