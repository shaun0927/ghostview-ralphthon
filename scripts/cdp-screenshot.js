#!/usr/bin/env node
// cdp-screenshot.js — Capture screenshot via Chrome DevTools Protocol (raw WebSocket, NOT Puppeteer)
// Usage: node scripts/cdp-screenshot.js <tabId> <outputPath>

const http = require('http');
const fs = require('fs');
const { WebSocket } = require('ws');

const [,, tabId, outputPath] = process.argv;
if (!tabId || !outputPath) {
  console.error('Usage: node cdp-screenshot.js <tabId> <outputPath>');
  process.exit(1);
}

async function getWsUrl(tabId) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const tabs = JSON.parse(data);
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) reject(new Error('Tab not found: ' + tabId));
        else resolve(tab.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function captureScreenshot(wsUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    ws.on('message', (msg) => {
      const resp = JSON.parse(msg.toString());
      if (resp.id === 1) {
        if (resp.error) {
          reject(new Error(resp.error.message));
        } else {
          const buf = Buffer.from(resp.result.data, 'base64');
          fs.writeFileSync(outputPath, buf);
          console.log('Saved: ' + outputPath + ' (' + buf.length + ' bytes)');
          resolve();
        }
        ws.close();
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 10000);
  });
}

(async () => {
  const wsUrl = await getWsUrl(tabId);
  await captureScreenshot(wsUrl, outputPath);
})().catch(err => { console.error(err.message); process.exit(1); });
