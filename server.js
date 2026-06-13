// src/server.js
//
// Express server that:
// - Serves the dashboard (public/index.html)
// - Runs the Quotex scraper + signal engine
// - Pushes new signals to connected clients via Socket.io

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { processCandle } = require('./signalEngine');
const { startScraper } = require('./quotexScraper');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// Keep the latest signal per pair in memory
const latestSignals = {};

app.get('/signals', (req, res) => {
  res.json(Object.values(latestSignals));
});

io.on('connection', (socket) => {
  console.log('Dashboard client connected');
  // Send current state immediately on connect
  socket.emit('init', Object.values(latestSignals));
});

function handleNewCandle(pair, candle) {
  const signal = processCandle(pair, candle);
  if (signal) {
    latestSignals[pair] = signal;
    console.log('SIGNAL:', signal);
    io.emit('signal', signal);
  }
}

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);

  // Start the Quotex scraper. If it fails (e.g. no network access in this
  // environment, or selectors need adjusting), the server still runs so
  // the dashboard UI can be tested.
  startScraper(handleNewCandle).catch((err) => {
    console.error('Scraper failed to start:', err.message);
    console.error('The dashboard will still run, but no live signals will appear until the scraper is fixed.');
  });
});
