import { Site, Stats } from './types'

export const MOCK_SITES: Site[] = [
  { id: '1', url: 'https://www.naver.com', domain: 'naver.com', category: 'portal', parity_score: 72.3, ghost_count: 45, ambiguous_count: 8, duplicate_count: 22, total_interactive: 280, scanned_at: '2026-03-28T12:00:00Z', has_report: true },
  { id: '2', url: 'https://www.daum.net', domain: 'daum.net', category: 'portal', parity_score: 68.1, ghost_count: 52, ambiguous_count: 11, duplicate_count: 18, total_interactive: 310, scanned_at: '2026-03-28T12:01:00Z', has_report: true },
  { id: '3', url: 'https://www.gmarket.co.kr', domain: 'gmarket.co.kr', category: 'commerce', parity_score: 41.5, ghost_count: 98, ambiguous_count: 15, duplicate_count: 45, total_interactive: 420, scanned_at: '2026-03-28T12:02:00Z', has_report: false },
  { id: '4', url: 'https://www.seoul.go.kr', domain: 'seoul.go.kr', category: 'government', parity_score: 85.2, ghost_count: 12, ambiguous_count: 3, duplicate_count: 8, total_interactive: 150, scanned_at: '2026-03-28T12:03:00Z', has_report: true },
  { id: '5', url: 'https://www.snu.ac.kr', domain: 'snu.ac.kr', category: 'education', parity_score: 79.8, ghost_count: 18, ambiguous_count: 5, duplicate_count: 10, total_interactive: 180, scanned_at: '2026-03-28T12:04:00Z', has_report: false },
  { id: '6', url: 'https://www.chosun.com', domain: 'chosun.com', category: 'news', parity_score: 55.3, ghost_count: 67, ambiguous_count: 12, duplicate_count: 30, total_interactive: 350, scanned_at: '2026-03-28T12:05:00Z', has_report: true },
  { id: '7', url: 'https://www.coupang.com', domain: 'coupang.com', category: 'commerce', parity_score: 38.7, ghost_count: 112, ambiguous_count: 20, duplicate_count: 55, total_interactive: 480, scanned_at: '2026-03-28T12:06:00Z', has_report: true },
  { id: '8', url: 'https://www.korea.kr', domain: 'korea.kr', category: 'government', parity_score: 91.0, ghost_count: 6, ambiguous_count: 2, duplicate_count: 4, total_interactive: 120, scanned_at: '2026-03-28T12:07:00Z', has_report: false },
  { id: '9', url: 'https://www.hani.co.kr', domain: 'hani.co.kr', category: 'news', parity_score: 62.4, ghost_count: 41, ambiguous_count: 9, duplicate_count: 25, total_interactive: 260, scanned_at: '2026-03-28T12:08:00Z', has_report: false },
  { id: '10', url: 'https://www.11st.co.kr', domain: '11st.co.kr', category: 'commerce', parity_score: 44.2, ghost_count: 89, ambiguous_count: 14, duplicate_count: 38, total_interactive: 390, scanned_at: '2026-03-28T12:09:00Z', has_report: true },
]

export const MOCK_STATS: Stats = {
  totalSites: MOCK_SITES.length,
  avgParity: Math.round(MOCK_SITES.reduce((a, s) => a + s.parity_score, 0) / MOCK_SITES.length * 10) / 10,
  totalGhosts: MOCK_SITES.reduce((a, s) => a + s.ghost_count, 0),
}
