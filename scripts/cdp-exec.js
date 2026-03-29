#!/usr/bin/env node
// cdp-exec.js — Execute JS in a Chrome tab via CDP and return result
// Usage: node scripts/cdp-exec.js <tabId> <jsCode>

const http = require('http');
const fs = require('fs');
const { WebSocket } = require('ws');

const [,, tabId, jsCode] = process.argv;
if (!tabId || !jsCode) {
  console.error('Usage: node cdp-exec.js <tabId> "<jsCode>"');
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

async function execJS(wsUrl, code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: code, returnByValue: true, awaitPromise: true }
      }));
    });
    ws.on('message', (msg) => {
      const resp = JSON.parse(msg.toString());
      if (resp.id === 1) {
        if (resp.error) {
          console.error('CDP error:', resp.error.message);
        } else if (resp.result.exceptionDetails) {
          console.error('JS error:', resp.result.exceptionDetails.text);
        } else {
          const val = resp.result.result.value;
          console.log(typeof val === 'object' ? JSON.stringify(val) : val);
        }
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
  });
}

(async () => {
  const wsUrl = await getWsUrl(tabId);
  await execJS(wsUrl, jsCode);
})().catch(err => { console.error(err.message); process.exit(1); });
