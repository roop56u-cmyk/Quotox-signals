// src/signalEngine.js
//
// Takes a stream of OHLC candles per pair and generates BUY/SELL signals
// using EMA crossover + RSI confirmation + ATR-based trailing stop filter.

const { EMA, RSI, ATR } = require('technicalindicators');

const FAST_EMA = 5;
const SLOW_EMA = 20;
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 2;
const SIGNAL_VALID_MINUTES = 1; // matches candle timeframe (1 min)

// Per-pair candle history and trailing stop state
const candleHistory = {}; // { pairName: [{open,high,low,close,time}, ...] }
const trailingState = {}; // { pairName: { trail: number, direction: 'up'|'down' } }

const MAX_CANDLES = 200; // keep enough history for indicators

function addCandle(pair, candle) {
  if (!candleHistory[pair]) candleHistory[pair] = [];
  candleHistory[pair].push(candle);
  if (candleHistory[pair].length > MAX_CANDLES) {
    candleHistory[pair].shift();
  }
}

function computeTrailingStop(pair, candles) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const atrValues = ATR.calculate({
    period: ATR_PERIOD,
    high: highs,
    low: lows,
    close: closes
  });

  if (atrValues.length === 0) return null;

  const lastAtr = atrValues[atrValues.length - 1];
  const lastClose = closes[closes.length - 1];
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];

  if (!trailingState[pair]) {
    trailingState[pair] = {
      trail: lastClose - lastAtr * ATR_MULTIPLIER,
      direction: 'up'
    };
    return trailingState[pair];
  }

  const state = trailingState[pair];

  if (state.direction === 'up') {
    const newTrail = lastHigh - lastAtr * ATR_MULTIPLIER;
    state.trail = Math.max(state.trail, newTrail);
    if (lastClose < state.trail) {
      state.direction = 'down';
      state.trail = lastLow + lastAtr * ATR_MULTIPLIER;
    }
  } else {
    const newTrail = lastLow + lastAtr * ATR_MULTIPLIER;
    state.trail = Math.min(state.trail, newTrail);
    if (lastClose > state.trail) {
      state.direction = 'up';
      state.trail = lastHigh - lastAtr * ATR_MULTIPLIER;
    }
  }

  return state;
}

/**
 * Process a new candle for a pair and return a signal object if one is generated,
 * or null if no signal triggers on this candle.
 */
function processCandle(pair, candle) {
  addCandle(pair, candle);
  const candles = candleHistory[pair];

  // Need enough candles for the slowest indicator (EMA20 / RSI14 / ATR14)
  if (candles.length < SLOW_EMA + 1) return null;

  const closes = candles.map(c => c.close);

  const fastEmaValues = EMA.calculate({ period: FAST_EMA, values: closes });
  const slowEmaValues = EMA.calculate({ period: SLOW_EMA, values: closes });
  const rsiValues = RSI.calculate({ period: RSI_PERIOD, values: closes });

  if (fastEmaValues.length < 2 || slowEmaValues.length < 2 || rsiValues.length < 1) {
    return null;
  }

  const fastNow = fastEmaValues[fastEmaValues.length - 1];
  const fastPrev = fastEmaValues[fastEmaValues.length - 2];
  const slowNow = slowEmaValues[slowEmaValues.length - 1];
  const slowPrev = slowEmaValues[slowEmaValues.length - 2];
  const rsiNow = rsiValues[rsiValues.length - 1];

  const trailState = computeTrailingStop(pair, candles);
  if (!trailState) return null;

  // Detect EMA crossover
  const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
  const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

  let direction = null;

  // BUY: fast EMA crosses above slow EMA, RSI not overbought, trailing stop trend is "up"
  if (crossedUp && rsiNow < RSI_OVERBOUGHT && trailState.direction === 'up') {
    direction = 'BUY';
  }

  // SELL: fast EMA crosses below slow EMA, RSI not oversold, trailing stop trend is "down"
  if (crossedDown && rsiNow > RSI_OVERSOLD && trailState.direction === 'down') {
    direction = 'SELL';
  }

  if (!direction) return null;

  const now = new Date();
  const expiry = new Date(now.getTime() + SIGNAL_VALID_MINUTES * 60 * 1000);

  return {
    pair,
    direction,
    price: candle.close,
    rsi: Number(rsiNow.toFixed(2)),
    generatedAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
    validForMinutes: SIGNAL_VALID_MINUTES
  };
}

module.exports = { processCandle };
