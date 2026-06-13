# Quotex Signals Dashboard

A Node.js project that generates BUY/SELL trading signals from live price data
and displays them on a real-time web dashboard (which can be wrapped into an
Android APK via WebView).

## ⚠️ Important — read before using

- **Quotex has no official public API.** This project reads live price data by
  intercepting the WebSocket traffic inside Quotex's web app via Puppeteer
  (Chrome DevTools Protocol). This is **unofficial** and may violate Quotex's
  Terms of Service. Use at your own risk — your account could be flagged or
  restricted.
- **The WebSocket message format in `src/quotexScraper.js` (`parseWsMessage`)
  is a template/guess.** You MUST inspect the real traffic yourself:
  1. Open Quotex in Chrome.
  2. Open DevTools (F12) → Network tab → filter by "WS".
  3. Click the WebSocket connection → "Messages" tab.
  4. Watch the live messages and note their structure (field names, order).
  5. Update `parseWsMessage()` in `src/quotexScraper.js` to match.
- **This project does NOT place trades.** It only reads data and displays
  signals. You execute trades manually on Quotex yourself.
- Signals are generated using EMA crossover + RSI + ATR trailing-stop trend
  filter — a starting strategy, not a guaranteed-profit system. Backtest and
  adjust before relying on it.

## Project structure

```
quotex-signals/
├── package.json
├── public/
│   └── index.html        # Dashboard UI (auto-updates via Socket.io)
└── src/
    ├── server.js          # Express + Socket.io server
    ├── signalEngine.js     # EMA/RSI/ATR signal logic
    └── quotexScraper.js    # Puppeteer + WebSocket interception
```

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. (Optional) Set login credentials as environment variables, if you want the
   script to log in automatically:
   ```
   export QUOTEX_EMAIL="your-email@example.com"
   export QUOTEX_PASSWORD="your-password"
   ```
   Otherwise the scraper assumes you'll provide an existing logged-in session
   (e.g. by running with `headless: false` and logging in manually once, then
   reusing the browser profile — see notes below).

3. Run the project:
   ```
   npm start
   ```

4. Open the dashboard:
   ```
   http://localhost:3000
   ```

## Adjusting the scraper

In `src/quotexScraper.js`:

- `QUOTEX_URL` — set to the actual trading page URL.
- Login selectors (`input[type="email"]`, etc.) — adjust to match Quotex's
  real login form (inspect with DevTools).
- `parseWsMessage()` — adjust to match the real WebSocket message format you
  observe.
- For debugging, change `headless: 'new'` to `headless: false` so you can see
  the browser window and confirm it's loading/logging in correctly.

## Persisting a logged-in session

To avoid logging in every run, you can launch Puppeteer with a persistent user
data directory so cookies/session are reused:

```js
const browser = await puppeteer.launch({
  headless: false,
  userDataDir: './chrome-profile'
});
```

Log in manually once in that browser window; subsequent runs will reuse the
session.

## Adjusting signal strategy

In `src/signalEngine.js`, you can tune:

- `FAST_EMA` / `SLOW_EMA` — EMA crossover periods
- `RSI_PERIOD`, `RSI_OVERBOUGHT`, `RSI_OVERSOLD`
- `ATR_PERIOD`, `ATR_MULTIPLIER` — trailing stop sensitivity
- `SIGNAL_VALID_MINUTES` — how long a signal is shown as "Active"

## Deploying

This project needs a **persistent Node.js process** (not serverless), since
Puppeteer keeps a browser session open continuously.

Recommended: Railway, Render, or a VPS (with PM2 to keep it running).

```
npm install -g pm2
pm2 start src/server.js --name quotex-signals
```

Vercel is **not suitable** for this — its serverless functions can't keep a
browser/WebSocket session alive.

## Turning the dashboard into an Android APK

Once deployed (e.g. `https://your-project.up.railway.app`), wrap that URL in
a WebView using a tool like Median.co, GoNative, or a basic Android Studio
WebView project. The APK will show the live dashboard as a native-feeling app.
