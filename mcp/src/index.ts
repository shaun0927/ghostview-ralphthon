#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendEvent, readEvents, lastEvent } from './events.js';
import { issueStart, issueFinish, ghIssueList, ghIssueView, readPhaseGate } from './scripts.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CWD = process.env.GHOSTVIEW_CWD || process.cwd();

const server = new McpServer({
  name: 'ghostview-mcp',
  version: '0.1.0',
});

// ── gv_status: 현재 상태 반환 (context 압축 후 복원용) ──────────
server.tool(
  'gv_status',
  'Returns current pipeline status: phase, issues, progress. Call this after context compaction to restore awareness.',
  {},
  async () => {
    const gate = readPhaseGate(CWD);
    const ready = ghIssueList(CWD, 'status:ready');
    const inProgress = ghIssueList(CWD, 'status:in-progress');
    const done = ghIssueList(CWD, 'status:done');
    const blocked = ghIssueList(CWD, 'status:blocked');
    const last = lastEvent(CWD);

    const currentPhase = [0, 1, 2, 3, 4].find(i => gate[`phase${i}`] !== 'complete') ?? -1;

    const status = {
      currentPhase,
      phaseGate: gate,
      currentIssue: inProgress.length > 0 ? inProgress[0] : null,
      nextReady: ready.length > 0 ? ready[0] : null,
      stats: {
        ready: ready.length,
        inProgress: inProgress.length,
        done: done.length,
        blocked: blocked.length,
      },
      lastEvent: last,
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
  }
);

// ── gv_start: 이슈 시작 (issue-start.sh 래핑) ──────────────────
server.tool(
  'gv_start',
  'Start working on an issue. Runs issue-start.sh: reads issue, changes labels, creates branch. Returns issue body for AI to implement.',
  { issue: z.number().describe('Issue number to start') },
  async ({ issue }) => {
    appendEvent(CWD, { type: 'issue_starting', issue });

    const result = issueStart(CWD, issue);
    if (!result.success) {
      appendEvent(CWD, { type: 'issue_start_failed', issue, detail: { error: result.output } });
      return { content: [{ type: 'text' as const, text: `FAILED: ${result.output}` }] };
    }

    // Read the issue body for AI
    const issueData = ghIssueView(CWD, issue);
    appendEvent(CWD, { type: 'issue_started', issue, detail: { title: issueData?.title } });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'started',
          issue,
          title: issueData?.title,
          body: issueData?.body,
          scriptOutput: result.output,
        }, null, 2)
      }]
    };
  }
);

// ── gv_finish: 이슈 종료 (issue-finish.sh 래핑) ────────────────
server.tool(
  'gv_finish',
  'Finish an issue. Runs issue-finish.sh: commit, PR, merge, close, unblock dependents. Call AFTER code is written and verified.',
  { issue: z.number().describe('Issue number to finish') },
  async ({ issue }) => {
    appendEvent(CWD, { type: 'issue_finishing', issue });

    const result = issueFinish(CWD, issue);
    if (!result.success) {
      appendEvent(CWD, { type: 'issue_finish_failed', issue, detail: { error: result.output } });
      return { content: [{ type: 'text' as const, text: `FAILED: ${result.output}` }] };
    }

    // Find what got unblocked
    const ready = ghIssueList(CWD, 'status:ready');
    appendEvent(CWD, {
      type: 'issue_closed',
      issue,
      detail: { unblocked: ready.map(r => r.number), output: result.output.slice(-500) }
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'completed',
          issue,
          scriptOutput: result.output,
          nextReady: ready.length > 0 ? ready[0] : null,
        }, null, 2)
      }]
    };
  }
);

// ── gv_resume: 재개 지점 반환 ───────────────────────────────────
server.tool(
  'gv_resume',
  'Determine where to resume after interruption. Reads event log and returns the next action to take.',
  {},
  async () => {
    const events = readEvents(CWD);
    const last = events.length > 0 ? events[events.length - 1] : null;

    if (!last) {
      const ready = ghIssueList(CWD, 'status:ready');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'start_fresh',
            nextIssue: ready.length > 0 ? ready[0] : null,
            reason: 'No events found. Start from first ready issue.'
          }, null, 2)
        }]
      };
    }

    // If last event was issue_started but not closed → resume coding
    if (last.type === 'issue_started' || last.type === 'issue_starting') {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'continue_coding',
            issue: last.issue,
            reason: `Issue #${last.issue} was started but not finished. Continue coding and then call gv_finish.`
          }, null, 2)
        }]
      };
    }

    // If last event was issue_closed → start next
    if (last.type === 'issue_closed') {
      const ready = ghIssueList(CWD, 'status:ready');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'start_next',
            completedIssue: last.issue,
            nextIssue: ready.length > 0 ? ready[0] : null,
            reason: `Issue #${last.issue} completed. Pick up next ready issue.`
          }, null, 2)
        }]
      };
    }

    // If last event was a failure → retry or skip
    if (last.type.includes('failed')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'handle_failure',
            issue: last.issue,
            failureType: last.type,
            reason: `Last action failed. Review error and retry or skip.`
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ action: 'unknown', lastEvent: last, reason: 'Unrecognized state. Call gv_status for full picture.' }, null, 2)
      }]
    };
  }
);

// ── gv_verify: 스캔 결과 FP 검증 ────────────────────────────────
server.tool(
  'gv_verify',
  'Verify scan results for false positives. Picks N random scanned sites and returns FP check queries to run via OpenChrome. After running queries, pass results back to get FP analysis.',
  {
    count: z.number().default(5).describe('Number of random sites to verify (default 5)'),
    mode: z.enum(['pick', 'analyze']).default('pick').describe('"pick" returns sites+queries to run; "analyze" processes results'),
    results: z.string().optional().describe('JSON string of verification results (for mode=analyze)'),
  },
  async ({ count, mode, results }) => {
    if (mode === 'pick') {
      // Read scan-progress.json and pick random sites
      let scanResults: Array<{ url: string; domain: string; ghost_count?: number }> = [];
      try {
        const raw = readFileSync(join(CWD, 'state', 'scan-progress.json'), 'utf8');
        const progress = JSON.parse(raw);
        scanResults = progress.results || [];
      } catch {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No scan-progress.json found or no results yet' }) }] };
      }

      if (scanResults.length === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No scanned sites to verify' }) }] };
      }

      // Shuffle and pick N
      const shuffled = [...scanResults].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(count, shuffled.length));

      // Return sites and the FP check queries to run
      const fpQueries = {
        altImagesInClickables: `JSON.stringify(Array.from(document.querySelectorAll('a img[alt], button img[alt]')).filter(el => el.offsetWidth > 0 && el.getAttribute('alt').trim().length > 0).slice(0, 50).map(el => ({ tag: el.tagName, alt: el.getAttribute('alt'), parentTag: el.closest('a,button')?.tagName })))`,
        labeledLinks: `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).filter(el => el.offsetWidth > 0 && !el.textContent.trim() && (el.getAttribute('aria-label') || el.getAttribute('title'))).slice(0, 50).map(el => ({ tag: 'A', ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title') })))`,
        labeledButtons: `JSON.stringify(Array.from(document.querySelectorAll('button')).filter(el => el.offsetWidth > 0 && !el.textContent.trim() && (el.getAttribute('aria-label') || el.getAttribute('title'))).slice(0, 50).map(el => ({ tag: 'BUTTON', ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title') })))`,
        hiddenGhosts: `JSON.stringify(Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden])')).filter(el => { const s = window.getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'; }).slice(0, 50).map(el => ({ tag: el.tagName, display: window.getComputedStyle(el).display, visibility: window.getComputedStyle(el).visibility })))`,
        ghostCounts: `JSON.stringify({ unnamedLinks: Array.from(document.querySelectorAll('a[href]')).filter(el => el.offsetWidth > 0 && !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')).length, unnamedButtons: Array.from(document.querySelectorAll('button')).filter(el => el.offsetWidth > 0 && !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')).length, unnamedInputs: Array.from(document.querySelectorAll('input:not([type=hidden])')).filter(el => el.offsetWidth > 0 && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.getAttribute('placeholder') && !document.querySelector('label[for="' + el.id + '"]')).length, altlessImages: Array.from(document.querySelectorAll('a img, button img')).filter(el => el.offsetWidth > 0 && !el.getAttribute('alt') && !el.closest('a,button').getAttribute('aria-label')).length })`,
      };

      appendEvent(CWD, { type: 'verify_started', detail: { count: picked.length, sites: picked.map(s => s.domain) } });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'pick',
            sites: picked,
            queries: fpQueries,
            instructions: 'For each site: navigate to URL, run each query via batch_execute, collect results, then call gv_verify(mode="analyze", results=JSON.stringify(collectedResults))',
          }, null, 2)
        }]
      };
    }

    // mode === 'analyze'
    if (!results) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'results parameter required for analyze mode' }) }] };
    }

    let parsed: Array<{ domain: string; url: string; fpData: Record<string, unknown>; originalCounts?: Record<string, number> }>;
    try {
      parsed = JSON.parse(results);
    } catch {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid JSON in results parameter' }) }] };
    }

    const siteResults = parsed.map(site => {
      const ghostCounts = typeof site.fpData?.ghostCounts === 'string'
        ? JSON.parse(site.fpData.ghostCounts as string)
        : site.fpData?.ghostCounts || site.originalCounts || {};

      const fps: Array<{ type: string; count: number; description: string }> = [];

      const parse = (v: unknown) => {
        if (typeof v === 'string') try { return JSON.parse(v); } catch { return []; }
        return Array.isArray(v) ? v : [];
      };

      const altImages = parse(site.fpData?.altImagesInClickables);
      if (altImages.length > 0 && (ghostCounts.altlessImages || 0) > 0) {
        fps.push({ type: 'alt_images_in_clickables', count: altImages.length, description: `${altImages.length} images with alt inside clickables — potential FP in altlessImages` });
      }

      const hiddenGhosts = parse(site.fpData?.hiddenGhosts);
      if (hiddenGhosts.length > 0) {
        fps.push({ type: 'hidden_elements', count: hiddenGhosts.length, description: `${hiddenGhosts.length} hidden elements may leak into ghost count` });
      }

      return {
        domain: site.domain,
        url: site.url,
        verified: true,
        fpCount: fps.reduce((s, f) => s + f.count, 0),
        falsePositives: fps,
        ghostCounts,
      };
    });

    const totalFP = siteResults.reduce((s, r) => s + r.fpCount, 0);

    // Save results
    const report = {
      timestamp: new Date().toISOString(),
      sitesVerified: siteResults.length,
      totalFalsePositives: totalFP,
      sites: siteResults,
    };

    try {
      const { writeFileSync } = await import('fs');
      writeFileSync(join(CWD, 'state', 'verify-results.json'), JSON.stringify(report, null, 2));
    } catch { /* best effort */ }

    appendEvent(CWD, {
      type: 'verify_completed',
      detail: { verified: siteResults.length, falsePositives: totalFP }
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          verified: siteResults.length,
          falsePositives: totalFP,
          details: siteResults,
          savedTo: 'state/verify-results.json',
        }, null, 2)
      }]
    };
  }
);

// ── gv_scan_batch: 병렬 배치 스캔 패턴 ──────────────────────────
server.tool(
  'gv_scan_batch',
  'Returns optimized parallel scan pattern. mode=prepare: returns combined ghost query + sites to scan. mode=save: saves batch results to scan-progress.json checkpoint.',
  {
    mode: z.enum(['prepare', 'save']).default('prepare').describe('"prepare" returns query+sites; "save" checkpoints results'),
    batchSize: z.number().default(5).describe('Number of tabs to use in parallel (default 5)'),
    cursor: z.number().default(0).describe('Current cursor position in sites list (for prepare mode)'),
    results: z.string().optional().describe('JSON string of batch scan results (for save mode)'),
    failed: z.number().default(0).describe('Number of failed sites in this batch (for save mode)'),
    blocked: z.number().default(0).describe('Number of blocked sites in this batch (for save mode)'),
  },
  async ({ mode, batchSize, cursor, results, failed, blocked }) => {
    if (mode === 'prepare') {
      // Read site list
      let sites: Array<{ url: string; domain: string; category: string }> = [];
      try {
        const raw = readFileSync(join(CWD, 'config', 'sites-kr.json'), 'utf8');
        sites = JSON.parse(raw);
      } catch {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'config/sites-kr.json not found' }) }] };
      }

      // Slice from cursor
      const batch = sites.slice(cursor, cursor + batchSize);
      if (batch.length === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'complete', message: 'All sites scanned', cursor, totalSites: sites.length }) }] };
      }

      // Combined query — all ghost detection in one JS expression per tab
      const combinedQuery = `JSON.stringify({interactive:document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[onclick],[tabindex="0"]').length,ghost_links:Array.from(document.querySelectorAll('a[href]')).filter(e=>e.offsetWidth>0&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.querySelector('img[alt]')).length,ghost_buttons:Array.from(document.querySelectorAll('button')).filter(e=>e.offsetWidth>0&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length,ghost_inputs:Array.from(document.querySelectorAll('input:not([type=hidden])')).filter(e=>e.offsetWidth>0&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.getAttribute('placeholder')&&!document.querySelector('label[for="'+e.id+'"]')).length,ghost_images:Array.from(document.querySelectorAll('a img, button img')).filter(e=>e.offsetWidth>0&&!e.getAttribute('alt')&&!e.closest('a,button').getAttribute('aria-label')&&!e.closest('a,button').textContent.trim()).length,roleless:Array.from(document.querySelectorAll('[onclick],[tabindex="0"]')).filter(e=>e.offsetWidth>0&&!['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY','DETAILS'].includes(e.tagName)&&!e.getAttribute('role')).length,ambiguous_alt:Array.from(document.querySelectorAll('img[alt]')).filter(e=>e.offsetWidth>0&&/^(image|photo|icon|logo|banner|placeholder|img|pic|picture|graphic|untitled|no\\\\s*alt|alt|thumbnail)$/i.test(e.getAttribute('alt').trim())).length,dup_labels:(()=>{const l=Array.from(document.querySelectorAll('[aria-label]')).filter(e=>e.offsetWidth>0).map(e=>e.getAttribute('aria-label').trim()).filter(Boolean);const c={};l.forEach(x=>{c[x]=(c[x]||0)+1});return l.filter(x=>c[x]>=3).length})()})`;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'prepare',
            cursor,
            nextCursor: cursor + batch.length,
            totalSites: sites.length,
            batchSize: batch.length,
            sites: batch,
            combinedQuery,
            pattern: [
              `1. tabs_create: Open ${batch.length} tabs`,
              '2. navigate each tab to its site URL',
              `3. batch_execute with ${batch.length} tasks (one per tab), each running combinedQuery`,
              '4. Collect results, then call gv_scan_batch(mode="save", results=JSON.stringify(parsed))',
            ],
          }, null, 2)
        }]
      };
    }

    // mode === 'save'
    if (!results) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'results parameter required for save mode' }) }] };
    }

    let parsed: Array<Record<string, unknown>>;
    try {
      parsed = JSON.parse(results);
    } catch {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid JSON in results' }) }] };
    }

    // Read current progress
    const progressPath = join(CWD, 'state', 'scan-progress.json');
    let progress = { cursor: 0, completed: 0, failed: 0, blocked: 0, totalSites: 0, lastSavedAt: null as string | null, results: [] as Array<Record<string, unknown>> };
    try {
      const raw = readFileSync(progressPath, 'utf8');
      progress = JSON.parse(raw);
      if (!progress.results) progress.results = [];
    } catch { /* use defaults */ }

    // UPSERT: deduplicate by domain — re-scans overwrite existing entries
    const successful = parsed.filter(r => !r.error);
    const failedResults = parsed.filter(r => r.error);

    const existingByDomain = new Map<string, number>();
    progress.results.forEach((r: Record<string, unknown>, i: number) => {
      if (r.domain) existingByDomain.set(r.domain as string, i);
    });

    let updatedCount = 0;
    for (const result of successful) {
      const domain = result.domain as string;
      if (domain && existingByDomain.has(domain)) {
        // Overwrite existing entry (UPSERT)
        progress.results[existingByDomain.get(domain)!] = result;
        updatedCount++;
      } else {
        progress.results.push(result);
        progress.completed++;
      }
    }

    progress.failed += failedResults.length + failed;
    progress.blocked += blocked;
    progress.cursor = progress.completed + progress.failed + progress.blocked;
    progress.lastSavedAt = new Date().toISOString();

    // Get total sites count
    try {
      const sitesRaw = readFileSync(join(CWD, 'config', 'sites-kr.json'), 'utf8');
      progress.totalSites = JSON.parse(sitesRaw).length;
    } catch { /* keep existing */ }

    writeFileSync(progressPath, JSON.stringify(progress, null, 2));

    appendEvent(CWD, {
      type: 'scan_batch_saved',
      detail: { cursor: progress.cursor, completed: progress.completed, failed: progress.failed, blocked: progress.blocked }
    });

    const pct = progress.totalSites > 0 ? ((progress.cursor / progress.totalSites) * 100).toFixed(1) : '0';

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'saved',
          progress: `${progress.cursor}/${progress.totalSites} (${pct}%)`,
          completed: progress.completed,
          failed: progress.failed,
          blocked: progress.blocked,
          updated: updatedCount,
          cursor: progress.cursor,
          totalSites: progress.totalSites,
          done: progress.cursor >= progress.totalSites,
        }, null, 2)
      }]
    };
  }
);

// ── gv_log: 수동 이벤트 기록 ────────────────────────────────────
server.tool(
  'gv_log',
  'Append a custom event to the event log. Use for tracking verification results, phase transitions, etc.',
  {
    type: z.string().describe('Event type (e.g., "verification_passed", "phase_complete")'),
    issue: z.number().optional().describe('Related issue number'),
    phase: z.number().optional().describe('Related phase number'),
    detail: z.string().optional().describe('JSON string with additional details'),
  },
  async ({ type, issue, phase, detail }) => {
    const parsed = detail ? JSON.parse(detail) : undefined;
    const event = appendEvent(CWD, { type, issue, phase, detail: parsed });
    return { content: [{ type: 'text' as const, text: JSON.stringify(event) }] };
  }
);

// ── gv_visual_qa: 시각적 검증 체크리스트 ─────────────────────────
server.tool(
  'gv_visual_qa',
  'Visual QA checklist for live site verification. mode=checklist: returns items to verify via OpenChrome. mode=report: saves QA results to state/visual-qa.json. AI must complete ALL checklist items using OpenChrome before calling report mode.',
  {
    mode: z.enum(['checklist', 'report']).default('checklist').describe('"checklist" returns QA items; "report" saves results'),
    phase: z.number().default(4).describe('Phase to verify'),
    results: z.string().optional().describe('JSON string of QA results (for report mode)'),
  },
  async ({ mode, phase, results }) => {
    if (mode === 'checklist') {
      const deployUrl = (() => {
        try { return readFileSync(join(CWD, 'state', 'deploy-url.txt'), 'utf8').trim(); }
        catch { return 'https://ghostview-chi.vercel.app'; }
      })();

      const deepdiveSites = (() => {
        try {
          const d = JSON.parse(readFileSync(join(CWD, 'state', 'deepdive-progress.json'), 'utf8'));
          return d.completedSites || [];
        } catch { return []; }
      })();

      const detailSite = deepdiveSites[0] || 'findall.co.kr';
      const detailUrl = `${deployUrl}/site/${detailSite}`;

      const checklist = [
        {
          id: 'leaderboard_data',
          page: deployUrl,
          description: 'GhostView 제목 + Ghost 수 > 0 + worst-first 정렬',
          verifyScript: `(() => {
            const title = document.querySelector('h1');
            if (!title || !title.textContent.includes('GhostView')) return {passed:false, detail:'GhostView 제목 없음', fix:'app/page.tsx에 h1 GhostView 추가'};
            const cards = Array.from(document.querySelectorAll('p')).map(p=>p.textContent);
            const ghostCard = cards.find(c => c && c.includes('Ghost'));
            const rows = document.querySelectorAll('table tbody tr');
            if (rows.length < 5) return {passed:false, detail:'테이블 행 '+rows.length+'개 (5개 이상 필요)', fix:'app/page.tsx에서 .limit() 확인'};
            const firstScore = rows[0] ? rows[0].querySelectorAll('td')[3]?.textContent?.trim() : '?';
            if (firstScore === '100') return {passed:false, detail:'1위가 Parity 100 (worst-first여야)', fix:'app/page.tsx에서 order ascending:true 확인'};
            return {passed:true, detail:'제목 OK, 행 '+rows.length+'개, 1위 Parity='+firstScore};
          })()`,
        },
        {
          id: 'detail_page_renders',
          page: detailUrl,
          description: '상세 페이지에 도메인 + Parity + Ghost 수 표시',
          verifyScript: `(() => {
            const h1 = document.querySelector('h1');
            if (!h1) return {passed:false, detail:'h1 없음', fix:'app/site/[domain]/page.tsx 확인'};
            const domain = h1.textContent.trim();
            if (!domain.includes('.')) return {passed:false, detail:'도메인명 아님: '+domain, fix:'Supabase 쿼리 확인'};
            return {passed:true, detail:'도메인: '+domain};
          })()`,
        },
        {
          id: 'slider_interaction',
          page: detailUrl,
          description: '슬라이더 드래그 시 clip-path가 변함',
          verifyScript: `(() => {
            const slider = document.querySelector('input[type=range]');
            if (!slider) return {passed:false, detail:'슬라이더(input[type=range]) 없음', fix:'app/site/[domain]/slider.tsx에 range input 추가'};
            slider.value = '20';
            slider.dispatchEvent(new Event('input', {bubbles:true}));
            slider.dispatchEvent(new Event('change', {bubbles:true}));
            const container = slider.closest('div[style]') || slider.parentElement;
            const style = container ? container.getAttribute('style') || '' : '';
            const imgs = Array.from(document.querySelectorAll('img'));
            const clipped = imgs.find(i => {
              const s = i.getAttribute('style') || getComputedStyle(i).clipPath || '';
              return s.includes('clip') || s.includes('inset');
            });
            if (!clipped && !style.includes('20')) return {passed:false, detail:'슬라이더 이벤트 핸들러 없음 (oninput/onChange 누락)', fix:'slider.tsx에 onChange 핸들러 추가: setState로 --split CSS 변수 업데이트'};
            return {passed:true, detail:'슬라이더 동작 확인'};
          })()`,
        },
        {
          id: 'two_different_screenshots',
          page: detailUrl,
          description: 'normal과 blackhole 스크린샷이 다른 이미지',
          verifyScript: `(() => {
            const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.naturalWidth > 100);
            if (imgs.length < 2) {
              const allImgs = Array.from(document.querySelectorAll('img'));
              const broken = allImgs.filter(i => i.naturalWidth === 0 && i.src);
              return {passed:false, detail:'로드된 이미지 '+imgs.length+'개 (2개 필요). 깨진 이미지: '+broken.length+'개. src: '+broken.map(i=>i.src.slice(0,60)).join(', '), fix:'스크린샷 URL 확인: (1) Supabase Storage에 파일 존재하는지 (2) reports 테이블의 normalScreenshot/blackholeScreenshot URL이 올바른지 (3) public/screenshots/ 경로인 경우 Vercel에 배포됐는지'};
            }
            if (imgs[0].src === imgs[1].src) return {passed:false, detail:'두 이미지가 동일 URL', fix:'Deep Dive 시 normal과 blackhole을 별도 파일로 저장했는지 확인'};
            return {passed:true, detail:'normal: '+imgs[0].src.split('/').pop()+', blackhole: '+imgs[1].src.split('/').pop()};
          })()`,
        },
        {
          id: 'findings_cards_count',
          page: detailUrl,
          description: 'Finding 카드가 3개 이상 렌더링됨 (DOM 카운트, 텍스트 검색 아님)',
          verifyScript: `(() => {
            const heading = document.body.innerText.match(/Findings\\s*\\((\\d+)\\)/);
            const headingCount = heading ? parseInt(heading[1]) : 0;
            const cards = document.querySelectorAll('[class*=finding],[class*=card],[data-finding]');
            const codeBlocks = document.querySelectorAll('pre, code, [class*=fix]');
            const h3h4 = Array.from(document.querySelectorAll('h3,h4')).filter(h => {
              const t = h.textContent.toLowerCase();
              return t.includes('이미지') || t.includes('링크') || t.includes('버튼') || t.includes('입력') || t.includes('라벨') || t.includes('image') || t.includes('link') || t.includes('button') || t.includes('input') || t.includes('label') || t.includes('duplicate');
            });
            const findingCount = Math.max(headingCount, cards.length, h3h4.length);
            if (findingCount < 3) return {passed:false, detail:'Finding 카드 '+findingCount+'개 (heading:'+headingCount+', cards:'+cards.length+', category headings:'+h3h4.length+'). 3개 이상 필요.', fix:'근본 원인 3가지 수정: (1) deep dive 시 scan-progress.json의 details 객체(ghost_images, ghost_links, ghost_inputs, duplicate_labels)에서 count>0인 카테고리마다 finding 객체 생성. (2) findings를 [{...},{...},{...}] 배열로 Supabase reports.findings에 저장 (단일 객체 아님). (3) app/site/[domain]/page.tsx에서 findings.map()으로 각 finding을 카드로 렌더링. 템플릿: ghost_images>0→{severity:ghost,title:alt 없는 이미지 N개,description:...,fix:{code:img alt=설명}}, ghost_links>0→{severity:ghost,title:이름 없는 링크 N개,...}, ghost_inputs>0→{severity:ghost,title:라벨 없는 입력 N개,...}, duplicate_labels>0→{severity:duplicate,title:중복 라벨 N개,...}'};
            if (codeBlocks.length < findingCount) return {passed:false, detail:'수정 코드 블록 '+codeBlocks.length+'개 (finding '+findingCount+'개보다 적음)', fix:'각 finding에 fix.code를 <pre> 또는 <code>로 렌더링'};
            return {passed:true, detail:'Finding '+findingCount+'개, 수정 코드 '+codeBlocks.length+'개'};
          })()`,
        },
        {
          id: 'math_correctness',
          page: detailUrl,
          description: 'Ghost 퍼센트가 100% 이하 (수학 오류 방지)',
          verifyScript: `(() => {
            const text = document.body.innerText;
            const pctMatch = text.match(/Ghost[:\\s]*([\\d.]+)%/);
            if (pctMatch) {
              const pct = parseFloat(pctMatch[1]);
              if (pct > 100) return {passed:false, detail:'Ghost '+pct+'% (100% 초과)', fix:'Parity Score 계산 오류. 공식: parityScore = ((totalInteractive - ghostCount) / totalInteractive) * 100. ghostCount > totalInteractive이면 데이터 무결성 문제.'};
            }
            return {passed:true, detail:'수학 오류 없음'};
          })()`,
        },
        {
          id: 'slider_overlay_ux',
          page: detailUrl,
          description: '슬라이더 핸들이 이미지 위에 겹쳐져 있음 (이미지 밖 아님)',
          verifyScript: `(() => {
            const slider = document.querySelector('input[type=range]');
            const img = document.querySelector('img');
            if (!slider || !img) return {passed:false, detail:'슬라이더 또는 이미지 없음', fix:'slider.tsx 확인'};
            const sR = slider.getBoundingClientRect();
            const iR = img.getBoundingClientRect();
            const overlaps = sR.top < iR.bottom && sR.bottom > iR.top && sR.left < iR.right && sR.right > iR.left;
            if (!overlaps) return {passed:false, detail:'슬라이더(y='+Math.round(sR.top)+')가 이미지(y='+Math.round(iR.top)+'~'+Math.round(iR.bottom)+') 밖에 위치', fix:'slider를 이미지 컨테이너 안에 배치: position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:col-resize; z-index:10. 중앙 핸들 바도 absolute로 이미지 위에 배치.'};
            return {passed:true, detail:'슬라이더가 이미지 위에 겹침 확인'};
          })()`,
        },
        {
          id: 'live_scan_page',
          page: `${deployUrl}/scan`,
          description: '/scan 페이지 존재 + URL 입력 폼',
          verifyScript: `(() => {
            const input = document.querySelector('input[type=text],input[type=url],input[placeholder]');
            const button = document.querySelector('button');
            if (!input) return {passed:false, detail:'/scan 페이지에 URL 입력 폼 없음', fix:'app/scan/page.tsx에 <input type=url placeholder="https://example.com"> + <button>스캔</button> 추가'};
            if (!button) return {passed:false, detail:'/scan 페이지에 버튼 없음', fix:'스캔 시작 버튼 추가'};
            const is404 = document.body.innerText.includes('404') || document.body.innerText.includes('not found');
            if (is404) return {passed:false, detail:'/scan 페이지 404', fix:'app/scan/page.tsx 파일 생성 확인'};
            return {passed:true, detail:'URL 입력 + 버튼 존재'};
          })()`,
        },
        {
          id: 'live_scan_api',
          page: deployUrl,
          description: '/api/scan이 실제로 스캔을 완료하고 결과 반환',
          verifyScript: `(async () => {
            try {
              const r = await fetch('/api/scan', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:'https://example.com'})});
              if (!r.ok) return {passed:false, detail:'/api/scan HTTP '+r.status, fix:'Vercel Serverless Puppeteer 수정: (1) @sparticuz/chromium@131 사용 (2) puppeteer launch args: [--no-sandbox,--disable-setuid-sandbox,--disable-gpu,--single-process] (3) vercel.json에 maxDuration:30 설정 (4) ignoreDefaultArgs:["--enable-automation"] 추가 (5) browser.close()를 finally에서 호출 (6) Protocol error 시 page.setViewport를 goto 이후에 호출'};
              const data = await r.json();
              if (data.error) return {passed:false, detail:'스캔 에러: '+data.error, fix:'위와 동일한 Puppeteer 설정 수정'};
              if (!data.parityScore && data.parityScore !== 0) return {passed:false, detail:'응답에 parityScore 없음', fix:'route.ts에서 ghost query 실행 후 parityScore 반환'};
              return {passed:true, detail:'스캔 성공, parityScore='+data.parityScore};
            } catch(e) {
              return {passed:false, detail:'fetch 실패: '+e.message, fix:'CORS 또는 타임아웃. vercel.json 확인.'};
            }
          })()`,
        },
        {
          id: 'openchrome_branding',
          page: deployUrl,
          description: 'OpenChrome 크레딧 + 로고 + GitHub 링크',
          verifyScript: `(() => {
            const page = document.body.innerHTML;
            const hasLogo = page.includes('openchrome') || page.includes('OpenChrome');
            const hasLink = page.includes('github.com/shaun0927/openchrome');
            if (!hasLogo) return {passed:false, detail:'OpenChrome 크레딧 없음', fix:'footer에 "Made with OpenChrome" + 로고 + GitHub 링크 추가'};
            if (!hasLink) return {passed:false, detail:'OpenChrome GitHub 링크 없음', fix:'footer에 <a href="https://github.com/shaun0927/openchrome"> 링크 추가'};
            const logoImg = document.querySelector('img[src*=openchrome], img[alt*=openchrome], img[alt*=OpenChrome]');
            if (logoImg && logoImg.naturalWidth === 0) return {passed:false, detail:'OpenChrome 로고 이미지 깨짐 (로드 안 됨)', fix:'로고 URL 확인. https://raw.githubusercontent.com/shaun0927/openchrome/main/assets/icon.png 가 유효한지 확인. 404이면 레포의 실제 이미지 경로 사용 또는 텍스트 로고로 대체'};
            return {passed:true, detail:'OpenChrome 브랜딩 확인'};
          })()`,
        },
        {
          id: 'i18n_toggle',
          page: deployUrl,
          description: '한국어/영어 전환 토글 존재',
          verifyScript: `(() => {
            const page = document.body.innerHTML;
            const hasToggle = page.includes('🇰🇷') || page.includes('🇺🇸') || page.includes('EN') || page.includes('KO') || document.querySelector('[class*=lang],[class*=locale],[class*=i18n],button[aria-label*=lang]');
            if (!hasToggle) return {passed:false, detail:'언어 전환 토글 없음', fix:'헤더에 KO/EN 토글 버튼 추가. PLAN.md Appendix G 참조.'};
            const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.match(/EN|KO|🇰🇷|🇺🇸/));
            if (toggleBtn) toggleBtn.click();
            const afterClick = document.body.innerText;
            const hasEnglishUI = afterClick.includes('Leaderboard') || afterClick.includes('Scanned Sites');
            if (!hasEnglishUI) return {passed:false, detail:'EN 클릭 후 UI가 영어로 안 바뀜', fix:'토글 onClick에서 locale ko↔en 전환. 모든 UI 텍스트를 dict에서 로드.'};
            return {passed:true, detail:'UI 영어 전환 확인'};
          })()`,
        },
        {
          id: 'i18n_findings_en',
          page: `${detailUrl}`,
          description: 'EN 모드에서 findings 내용도 영어로 표시',
          verifyScript: `(() => {
            const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.match(/EN|KO|🇰🇷|🇺🇸/));
            if (!toggleBtn) return {passed:false, detail:'토글 없음', fix:'Appendix G 참조'};
            if (toggleBtn.textContent.includes('EN') || toggleBtn.textContent.includes('🇺🇸')) toggleBtn.click();
            const text = document.body.innerText;
            const hasKoreanTitle = text.includes('속성 누락') || text.includes('이름 없음') || text.includes('라벨 없음');
            const hasEnglishTitle = text.includes('Missing alt') || text.includes('No accessible name') || text.includes('No label');
            if (hasKoreanTitle && !hasEnglishTitle) return {passed:false, detail:'EN 모드에서 findings가 한국어로 남아있음', fix:'findings를 {title:{ko:...,en:...}} 형태로 저장하고, 렌더링 시 finding.title[locale] 사용. PLAN.md Appendix G의 findings 번역 템플릿 참조. deep dive 시 ko/en 쌍으로 생성.'};
            return {passed:true, detail:'EN 모드에서 findings 영어 표시 확인'};
          })()`,
        },
        {
          id: 'hero_narrative',
          page: deployUrl,
          description: '사이트 전면에 "왜 이것이 중요한가" 메시지 표시',
          verifyScript: `(() => {
            const text = document.body.innerText;
            const hasNarrative = text.includes('간판') || text.includes('시각장애') || text.includes('signage') || text.includes('blind');
            if (!hasNarrative) return {passed:false, detail:'전면 메시지 없음', fix:'리더보드 위에 히어로 메시지 섹션 추가. PLAN.md Appendix I 참조. 한/영 전환 지원. 핵심: AI는 웹을 시각장애인처럼 보고 있다. 간판(alt, aria-label)이 없으면 AI에게 그 요소는 존재하지 않는다.'};
            return {passed:true, detail:'전면 메시지 표시 확인'};
          })()`,
        },
      ];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            phase,
            deployUrl,
            deepdiveSites,
            checklist,
            instructions: 'OpenChrome으로 각 항목을 검증한 후, gv_visual_qa(mode="report", results=JSON.stringify([{id, passed, detail}])) 호출',
          }, null, 2)
        }]
      };
    }

    // mode === 'report'
    if (!results) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'results parameter required for report mode' }) }] };
    }

    let parsed: Array<{ id: string; passed: boolean; detail?: string }>;
    try {
      parsed = JSON.parse(results);
    } catch {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid JSON in results' }) }] };
    }

    const allPassed = parsed.every(r => r.passed);
    const report = {
      phase,
      timestamp: new Date().toISOString(),
      allPassed,
      totalChecks: parsed.length,
      passedChecks: parsed.filter(r => r.passed).length,
      failedChecks: parsed.filter(r => !r.passed).length,
      results: parsed,
    };

    writeFileSync(join(CWD, 'state', 'visual-qa.json'), JSON.stringify(report, null, 2));

    appendEvent(CWD, {
      type: 'visual_qa_completed',
      phase,
      detail: { allPassed, passed: report.passedChecks, failed: report.failedChecks },
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: allPassed ? 'ALL_PASSED' : 'SOME_FAILED',
          ...report,
        }, null, 2)
      }]
    };
  }
);

// ── Start server ────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ghostview-mcp running (cwd: ' + CWD + ')');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
