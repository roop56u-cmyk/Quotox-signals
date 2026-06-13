// src/quotexScraper.js
//
// Launches Puppeteer, opens Quotex, logs in, and intercepts the WebSocket
// connection to extract live price/candle data per pair.
//
// IMPORTANT: Quotex's WebSocket message format is NOT officially documented
// and changes over time. The parsing logic below (parseWsMessage) is a
// TEMPLATE based on the general shape of these feeds — you WILL need to
// inspect real traffic (Chrome DevTools > Network > WS) and adjust the
// field names/array positions to match what Quotex actually sends.
//
// This script does NOT click any buttons or place trades — read-only.

const puppeteer = require('puppeteer');

const QUOTEX_URL = 'https://qxbroker.com/en/trade'; // adjust if needed
const EMAIL = process.env.QUOTEX_EMAIL || '';
const PASSWORD = process.env.QUOTEX_PASSWORD || '';

// In-progress candle builder per pair (aggregates ticks into 1-min candles)
const candleBuilders = {};
const CANDLE_TIMEFRAME_MS = 60 * 1000; // 1 minute

/**
 * Feed a raw tick (price update) into the candle builder for a pair.
 * Calls onCandleClose(pair, candle) whenever a candle period completes.
 */
function feedTick(pair, price, timestamp, onCandleClose) {
  const candleStart = Math.floor(timestamp / CANDLE_TIMEFRAME_MS) * CANDLE_TIMEFRAME_MS;

  if (!candleBuilders[pair] || candleBuilders[pair].start !== candleStart) {
    // Close out the previous candle if it exists
    if (candleBuilders[pair]) {
      onCandleClose(pair, candleBuilders[pair].candle);
    }
    candleBuilders[pair] = {
      start: candleStart,
      candle: { open: price, high: price, low: price, close: price, time: candleStart }
    };
  } else {
    const c = candleBuilders[pair].candle;
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    c.close = price;
  }
}

/**
 * Parse a raw WebSocket message from Quotex and extract pair/price/timestamp.
 * ADAPT THIS to match the real message format you observe in DevTools.
 *
 * Expected return: { pair: string, price: number, timestamp: number } or null
 */
function parseWsMessage(raw) {
  try {
    const data = JSON.parse(raw);

    // Example guess at format — Quotex often sends arrays like:
    // ["EURUSD_otc", 1718000000, 1.07321]
    if (Array.isArray(data) && data.length >= 3 && typeof data[0] === 'string') {
      return {
        pair: data[0],
        timestamp: data[1] * 1000, // assume seconds -> ms
        price: data[2]
      };
    }

    // Or an object format: { asset: "EURUSD_otc", time: ..., price: ... }
    if (data && data.asset && data.price) {
      return {
        pair: data.asset,
        timestamp: (data.time || Date.now() / 1000) * 1000,
        price: data.price
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Start the scraper. onSignalCandle is called with (pair, candle)
 * whenever a 1-minute candle closes, ready to feed into the signal engine.
 */
async function startScraper(onSignalCandle) {
  const browser = await puppeteer.launch({
    headless: 'new', // set to false to watch the browser while debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // --- Intercept WebSocket frames via Chrome DevTools Protocol ---
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  client.on('Network.webSocketFrameReceived', ({ response }) => {
    const raw = response.payloadData;
    const parsed = parseWsMessage(raw);
    if (!parsed) return;

    feedTick(parsed.pair, parsed.price, parsed.timestamp, (pair, candle) => {
      onSignalCandle(pair, candle);
    });
  });

  await page.goto(QUOTEX_URL, { waitUntil: 'networkidle2' });

  // --- Login (adjust selectors to match Quotex's actual login form) ---
  if (EMAIL && PASSWORD) {
    try {
      await page.waitForSelector('input[type="email"]', { timeout: 15000 });
      await page.type('input[type="email"]', EMAIL, { delay: 50 });
      await page.type('input[type="password"]', PASSWORD, { delay: 50 });
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
    } catch (err) {
      console.error('Login step failed or not needed (check selectors):', err.message);
    }
  } else {
    console.warn('QUOTEX_EMAIL / QUOTEX_PASSWORD not set — assuming an existing session/cookies.');
  }

  console.log('Quotex scraper running. Waiting for price data...');

  // Keep the browser open indefinitely
  return browser;
}

module.exports = { startScraper };
