export interface Site {
  id: string
  url: string
  domain: string
  category: string
  parity_score: number
  ghost_count: number
  ambiguous_count: number
  duplicate_count: number
  total_interactive: number
  scanned_at: string
  has_report: boolean
}

export interface Report {
  id: string
  site_id: string
  normal_screenshot_url: string | null
  blackhole_screenshot_url: string | null
  findings: Finding[]
  created_at: string
}

export interface Finding {
  severity: 'ghost' | 'ambiguous' | 'duplicate'
  title: string | { ko: string; en: string }
  description: string | { ko: string; en: string }
  elementInfo: string
  impact: string | { ko: string; en: string }
  fix: {
    label: string | { ko: string; en: string }
    code: string
  }
  screenshots?: {
    normal: string
    ghost: string
  }
}

export interface Stats {
  totalSites: number
  avgParity: number
  totalGhosts: number
}
