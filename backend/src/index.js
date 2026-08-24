'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API placeholder — Phase B and C will expand this
app.get('/api', (_req, res) => {
  res.json({ message: 'Homelab API v1' });
});

app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});
