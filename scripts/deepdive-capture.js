#!/usr/bin/env node
// deepdive-capture.js — Capture before/after screenshots for deep dive sites
// Uses raw CDP (not Puppeteer) to navigate, detect ghosts, and capture screenshots
//
// Usage: node scripts/deepdive-capture.js

const http = require('http');
const fs = require('fs');
const { WebSocket } = require('ws');

const SITES = [
  { domain: 'ably.com', url: 'https://www.ably.com' },
  { domain: 'kurly.com', url: 'https://www.kurly.com' },
  { domain: 'gmarket.co.kr', url: 'https://www.gmarket.co.kr' },
  { domain: 'tmon.co.kr', url: 'https://www.tmon.co.kr' },
  { domain: 'kyobobook.co.kr', url: 'https://www.kyobobook.co.kr' },
  { domain: 'auction.co.kr', url: 'https://www.auction.co.kr' },
  { domain: 'danawa.com', url: 'https://www.danawa.com' },
  { domain: 'donga.com', url: 'https://www.donga.com' },
  { domain: 'musinsa.com', url: 'https://www.musinsa.com' },
  { domain: 'coupang.com', url: 'https://www.coupang.com' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPSession {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.ws = null; this.pending = {}; }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (msg) => {
        const resp = JSON.parse(msg.toString());
        if (resp.id && this.pending[resp.id]) {
          this.pending[resp.id](resp);
          delete this.pending[resp.id];
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending[id] = (resp) => {
        if (resp.error) reject(new Error(resp.error.message));
        else resolve(resp.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending[id]) {
          delete this.pending[id];
          reject(new Error('timeout: ' + method));
        }
      }, 30000);
    });
  }

  close() { if (this.ws) this.ws.close(); }
}

const BLACKHOLE_JS = `
(function(){
  var n = 0;
  // Ghost images: no alt or empty alt
  var imgs = document.querySelectorAll('img:not([alt]),img[alt=""]');
  for (var i = 0; i < imgs.length; i++) {
    var el = imgs[i];
    if (el.offsetWidth < 10 || el.offsetHeight < 10) continue;
    var h = document.createElement('div');
    h.className = 'gv-replaced';
    h.style.cssText = 'width:'+el.offsetWidth+'px;height:'+el.offsetHeight+'px;background:#111;display:flex;align-items:center;justify-content:center;border:2px solid #333;border-radius:4px';
    h.innerHTML = '<span style="color:#555;font:900 28px system-ui">?</span>';
    el.parentNode.replaceChild(h, el);
    n++;
  }
  // Ghost inputs: no label
  var inputs = document.querySelectorAll('input:not([aria-label]):not([placeholder])');
  for (var j = 0; j < inputs.length; j++) {
    var inp = inputs[j];
    if (inp.offsetWidth < 10 || inp.type === 'hidden') continue;
    if (!inp.labels || inp.labels.length === 0) {
      inp.style.cssText += ';background:#111 !important;border:2px solid #333 !important;color:#555 !important';
      n++;
    }
  }
  return n;
})()
`;

const SCROLL_AND_DETECT_JS = `
(function(){
  var imgs = document.querySelectorAll('img:not([alt]),img[alt=""]');
  var visible = [];
  for (var i = 0; i < imgs.length; i++) {
    if (imgs[i].offsetWidth > 30 && imgs[i].offsetHeight > 30) {
      visible.push(Math.round(imgs[i].getBoundingClientRect().top + window.scrollY));
    }
  }
  var vh = window.innerHeight;
  var bestY = 0, bestCount = 0;
  for (var y = 0; y <= document.body.scrollHeight - vh; y += 200) {
    var count = 0;
    for (var j = 0; j < visible.length; j++) {
      if (visible[j] >= y && visible[j] < y + vh) count++;
    }
    if (count > bestCount) { bestCount = count; bestY = y; }
  }
  if (bestCount === 0) bestY = Math.min(800, document.body.scrollHeight / 3);
  window.scrollTo(0, bestY);
  return JSON.stringify({ ghostImages: visible.length, bestY: bestY, bestCount: bestCount });
})()
`;

async function processOneSite(cdp, site) {
  console.log(`\n[${site.domain}] Navigating...`);

  // Navigate
  try {
    await cdp.send('Page.navigate', { url: site.url });
    await sleep(5000);
  } catch (e) {
    console.log(`  SKIP: navigation failed — ${e.message}`);
    return false;
  }

  // Trigger lazy loading by scrolling
  try {
    await cdp.send('Runtime.evaluate', {
      expression: `(function(){
        return new Promise(function(resolve){
          var y=0,step=800,maxY=document.body.scrollHeight;
          var iv=setInterval(function(){
            y+=step;window.scrollTo(0,y);
            if(y>=maxY){clearInterval(iv);window.scrollTo(0,0);setTimeout(function(){resolve('done')},500);}
          },150);
        });
      })()`,
      awaitPromise: true,
      timeout: 20000,
    });
  } catch (e) {
    console.log(`  WARN: scroll failed — ${e.message}`);
  }
  await sleep(1000);

  // Find densest ghost viewport and scroll there
  try {
    const detectResult = await cdp.send('Runtime.evaluate', {
      expression: SCROLL_AND_DETECT_JS,
      returnByValue: true,
    });
    if (detectResult.result && detectResult.result.value) {
      console.log(`  Ghost detection: ${detectResult.result.value}`);
    }
  } catch (e) {
    console.log(`  WARN: detection failed — ${e.message}`);
  }
  await sleep(500);

  // Take normal screenshot
  const normalPath = `/tmp/gv-${site.domain}-normal.png`;
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(normalPath, Buffer.from(screenshot.data, 'base64'));
    console.log(`  normal: ${fs.statSync(normalPath).size} bytes`);
  } catch (e) {
    console.log(`  FAIL: normal screenshot — ${e.message}`);
    return false;
  }

  // Apply blackhole
  try {
    const bhResult = await cdp.send('Runtime.evaluate', {
      expression: BLACKHOLE_JS,
      returnByValue: true,
    });
    const replaced = bhResult.result ? bhResult.result.value : 0;
    console.log(`  blackhole: ${replaced} elements replaced`);
  } catch (e) {
    console.log(`  WARN: blackhole failed — ${e.message}`);
  }
  await sleep(500);

  // Take blackhole screenshot
  const blackholePath = `/tmp/gv-${site.domain}-blackhole.png`;
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(blackholePath, Buffer.from(screenshot.data, 'base64'));
    console.log(`  blackhole: ${fs.statSync(blackholePath).size} bytes`);
  } catch (e) {
    console.log(`  FAIL: blackhole screenshot — ${e.message}`);
    return false;
  }

  // Verify screenshots differ
  const nSize = fs.statSync(normalPath).size;
  const bSize = fs.statSync(blackholePath).size;
  if (Math.abs(nSize - bSize) < 100) {
    console.log(`  WARN: screenshots may be identical (diff=${Math.abs(nSize-bSize)})`);
  } else {
    console.log(`  OK: diff=${nSize - bSize} bytes`);
  }

  return true;
}

async function main() {
  const targets = await getTargets();
  if (targets.length === 0) {
    console.error('No Chrome tabs found on localhost:9222');
    process.exit(1);
  }

  // Use the first available tab
  const target = targets.find(t => t.type === 'page');
  if (!target) {
    console.error('No page tab found');
    process.exit(1);
  }

  console.log(`Using tab: ${target.id}`);
  const cdp = new CDPSession(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');

  let success = 0;
  let failed = 0;

  for (const site of SITES) {
    try {
      const ok = await processOneSite(cdp, site);
      if (ok) success++; else failed++;
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      failed++;
    }
  }

  cdp.close();
  console.log(`\nDone: ${success} captured, ${failed} failed`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
