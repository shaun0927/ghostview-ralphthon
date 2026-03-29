#!/usr/bin/env node
// upload-deepdive.js — Upload deep dive reports (findings + screenshots) to Supabase
// Called by issue-finish.sh after Phase 2 completion
//
// Reads: state/deepdive-reports.json
// Env:   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const REPORTS_PATH = path.join(__dirname, '..', 'state', 'deepdive-reports.json');

function env(key) {
  const v = process.env[key];
  if (!v) { console.error(`Missing env: ${key}`); process.exit(1); }
  return v;
}

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function uploadScreenshot(supabaseUrl, apiKey, domain, type, filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP screenshot: ${filePath} not found`);
    return null;
  }
  const fileData = fs.readFileSync(filePath);
  const storagePath = `deepdive/${domain}-${type}.png`;
  const url = `${supabaseUrl}/storage/v1/object/screenshots/${storagePath}`;

  try {
    await request(url, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
    }, fileData);
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/screenshots/${storagePath}`;
    console.log(`  uploaded: ${storagePath}`);
    return publicUrl;
  } catch (err) {
    console.error(`  WARN: upload failed for ${storagePath}: ${err.message}`);
    return null;
  }
}

async function upsertReport(supabaseUrl, apiKey, report) {
  const url = `${supabaseUrl}/rest/v1/reports?id=eq.${report.id}`;
  const body = JSON.stringify({
    findings: report.findings,
    normal_screenshot_url: report.normal_screenshot_url,
    blackhole_screenshot_url: report.blackhole_screenshot_url,
  });

  try {
    await request(url, {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
    }, body);
    console.log(`  updated report #${report.id} (${report.domain})`);
  } catch (err) {
    console.error(`  WARN: update failed for report #${report.id}: ${err.message}`);
  }
}

async function main() {
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL');
  const apiKey = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!fs.existsSync(REPORTS_PATH)) {
    console.log('No deepdive-reports.json found. Nothing to upload.');
    return;
  }

  const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf8'));
  console.log(`Uploading ${reports.length} deep dive reports...`);

  for (const report of reports) {
    console.log(`\n[${report.domain}]`);

    // Upload screenshots if local files exist
    const normalPath = `/tmp/gv-${report.domain}-normal.png`;
    const blackholePath = `/tmp/gv-${report.domain}-blackhole.png`;

    const normalUrl = await uploadScreenshot(supabaseUrl, apiKey, report.domain, 'normal', normalPath);
    const blackholeUrl = await uploadScreenshot(supabaseUrl, apiKey, report.domain, 'blackhole', blackholePath);

    if (normalUrl) report.normal_screenshot_url = normalUrl;
    if (blackholeUrl) report.blackhole_screenshot_url = blackholeUrl;

    // Update report in Supabase
    await upsertReport(supabaseUrl, apiKey, report);
  }

  // Save updated reports back
  fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));
  console.log(`\nDone. Updated ${reports.length} reports.`);
}

main().catch((err) => {
  console.error('upload-deepdive.js failed:', err.message);
  process.exit(1);
});
