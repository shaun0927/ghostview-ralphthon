#!/usr/bin/env node
// upload-screenshots.js — Upload deep dive screenshots to Supabase Storage
// Uses service_role key for storage access

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SERVICE_KEY;

const DOMAINS = [
  'ably.com', 'kurly.com', 'gmarket.co.kr', 'tmon.co.kr', 'kyobobook.co.kr',
  'auction.co.kr', 'danawa.com', 'donga.com', 'musinsa.com', 'coupang.com'
];

function req(url, options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function upload(domain, type) {
  const filePath = `/tmp/gv-${domain}-${type}.png`;
  if (!fs.existsSync(filePath)) return null;
  const fileData = fs.readFileSync(filePath);
  if (fileData.length < 5000) { console.log(`  skip ${type}: too small (${fileData.length})`); return null; }

  const storagePath = `deepdive/${domain}-${type}.png`;
  const url = `${SUPABASE_URL}/storage/v1/object/screenshots/${storagePath}`;
  const res = await req(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/png', 'x-upsert': 'true',
    }
  }, fileData);

  if (res.status >= 400) {
    console.log(`  FAIL ${type}: HTTP ${res.status} — ${res.data.substring(0, 100)}`);
    return null;
  }
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/screenshots/${storagePath}`;
  console.log(`  ${type}: uploaded (${fileData.length} bytes)`);
  return publicUrl;
}

async function updateReport(id, normalUrl, blackholeUrl) {
  const body = JSON.stringify({
    normal_screenshot_url: normalUrl,
    blackhole_screenshot_url: blackholeUrl,
  });
  const url = `${SUPABASE_URL}/rest/v1/reports?id=eq.${id}`;
  await req(url, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    }
  }, body);
}

async function main() {
  const reportsPath = path.join(__dirname, '..', 'state', 'deepdive-reports.json');
  const reports = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
  let uploaded = 0;

  for (const report of reports) {
    if (!DOMAINS.includes(report.domain)) continue;
    console.log(`[${report.domain}] id=${report.id}`);
    const normalUrl = await upload(report.domain, 'normal');
    const blackholeUrl = await upload(report.domain, 'blackhole');

    if (normalUrl || blackholeUrl) {
      if (normalUrl) report.normal_screenshot_url = normalUrl;
      if (blackholeUrl) report.blackhole_screenshot_url = blackholeUrl;
      await updateReport(report.id, report.normal_screenshot_url, report.blackhole_screenshot_url);
      uploaded++;
    } else {
      console.log(`  no screenshots to upload`);
    }
  }

  fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));
  console.log(`\nDone: ${uploaded} reports updated with screenshots.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
