#!/usr/bin/env node
// i18n-findings.js — Convert Korean-only findings to ko/en bilingual format
// Reads reports from Supabase, converts findings, updates back, saves local copy
//
// Usage: node scripts/i18n-findings.js

const fs = require('fs');
const path = require('path');
const https = require('https');

function env(key) {
  const v = process.env[key];
  if (!v) { console.error(`Missing env: ${key}`); process.exit(1); }
  return v;
}

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function patchReport(supabaseUrl, apiKey, id, findings) {
  const url = `${supabaseUrl}/rest/v1/reports?id=eq.${id}`;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ findings });
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Translation mapping: Korean title patterns → English equivalents
const TITLE_MAP = [
  { pattern: /alt 없는 이미지/i, en: 'Ghost Images: Missing alt attribute' },
  { pattern: /alt 없는 이미지 링크/i, en: 'Ghost Image Links: Missing alt in linked images' },
  { pattern: /라벨 없는 입력/i, en: 'Ghost Inputs: No label' },
  { pattern: /라벨 없는 폼/i, en: 'Ghost Form Controls: No label' },
  { pattern: /역할 없는 클릭/i, en: 'Ghost Clickables: No role attribute' },
  { pattern: /접근 가능한 이름 없는 링크/i, en: 'Ghost Links: No accessible name' },
  { pattern: /접근 가능한 이름 없는 버��/i, en: 'Ghost Buttons: No accessible name' },
  { pattern: /짧은 aria-label/i, en: 'Ambiguous: Short aria-label' },
  { pattern: /중복 aria-label/i, en: 'Duplicate Labels: Same name repeated' },
  { pattern: /중복 라벨/i, en: 'Duplicate Labels: Same name repeated' },
  { pattern: /빈 링크/i, en: 'Ghost Links: Empty link text' },
  { pattern: /빈 버튼/i, en: 'Ghost Buttons: Empty button text' },
  { pattern: /비시맨틱/i, en: 'Non-semantic Interactive: Missing role' },
];

const DESC_MAP = [
  { pattern: /alt 속성이 없/i, en: 'Images lack alt attribute, making them invisible to screen readers and AI assistants.' },
  { pattern: /링크 내부 이미지에 alt/i, en: 'Images inside links lack alt text, so the link purpose is unknown to assistive technology.' },
  { pattern: /label.*aria-label.*placeholder.*모두 없/i, en: 'Input fields have no label, aria-label, or placeholder, making their purpose unknown to machines.' },
  { pattern: /onclick.*tabindex.*role 속성이 없/i, en: 'Elements with click handlers or tabindex lack role attribute, making them unrecognizable as interactive elements.' },
  { pattern: /aria-label 값이.*이하/i, en: 'Aria-label is too short (2 chars or less) to convey meaningful purpose.' },
  { pattern: /동일한 aria-label 값이.*반복/i, en: 'Multiple elements share the same aria-label, causing confusion about which element to interact with.' },
];

const IMPACT_MAP = [
  { pattern: /이미지 내용을 인식할 수 없/i, en: 'AI/screen readers cannot identify image content, causing links to be ignored.' },
  { pattern: /무엇을 입력해야 하는지/i, en: 'Machines cannot determine what input is expected in the field.' },
  { pattern: /대화형 요소로 인식되지 않/i, en: 'Not recognized as interactive — keyboard and screen reader users cannot access it.' },
  { pattern: /라벨이 너무 짧/i, en: 'Label is too short to understand the element\'s purpose.' },
  { pattern: /어떤 것을 선택해야 하는지 혼란/i, en: 'Multiple elements with the same label create confusion about which to select.' },
];

const FIX_LABEL_MAP = [
  { pattern: /alt 속성 추가/i, en: 'Add alt attribute' },
  { pattern: /aria-label 추가/i, en: 'Add aria-label' },
  { pattern: /role.*button.*추가/i, en: 'Add role="button"' },
  { pattern: /설명적 라벨/i, en: 'Write descriptive label' },
  { pattern: /고유 라벨/i, en: 'Give unique label' },
  { pattern: /수정 방법/i, en: 'How to fix' },
];

function translate(text, map) {
  if (!text || typeof text === 'object') return text; // already translated
  for (const { pattern, en } of map) {
    if (pattern.test(text)) return en;
  }
  return text; // fallback: return original if no match
}

function i18nFinding(f) {
  if (!f || typeof f.title === 'object') return f; // already i18n

  return {
    severity: f.severity,
    title: {
      ko: f.title,
      en: translate(f.title, TITLE_MAP),
    },
    elementInfo: f.elementInfo,
    description: {
      ko: f.description,
      en: translate(f.description, DESC_MAP),
    },
    impact: {
      ko: f.impact,
      en: translate(f.impact, IMPACT_MAP),
    },
    fix: {
      code: f.fix?.code || '',
      label: {
        ko: f.fix?.label || '수정 방법',
        en: translate(f.fix?.label || '', FIX_LABEL_MAP),
      },
    },
  };
}

async function main() {
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL');
  const apiKey = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  // Fetch reports
  const reports = await request(
    `${supabaseUrl}/rest/v1/reports?select=*&order=parity_score.asc&limit=10`,
    { method: 'GET', headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` } }
  );

  console.log(`Processing ${reports.length} reports...`);

  for (const report of reports) {
    if (!report.findings || !Array.isArray(report.findings)) continue;

    const i18nFindings = report.findings.map(i18nFinding);
    report.findings = i18nFindings;

    await patchReport(supabaseUrl, apiKey, report.id, i18nFindings);
    console.log(`  ✓ ${report.domain} — ${i18nFindings.length} findings converted`);
  }

  // Save local copy
  const outPath = path.join(__dirname, '..', 'state', 'deepdive-reports.json');
  fs.writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`\nSaved to ${outPath}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('i18n-findings.js failed:', err.message);
  process.exit(1);
});
