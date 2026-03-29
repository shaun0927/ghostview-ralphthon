import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const domain = parsedUrl.hostname.replace(/^www\./, '')

    // Look up already-scanned site from Supabase
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data: site } = await supabase
        .from('sites')
        .select('*')
        .or(`domain.eq.${domain},domain.eq.www.${domain}`)
        .limit(1)
        .single()

      if (site) {
        // Fetch report if exists
        const { data: report } = await supabase
          .from('reports')
          .select('*')
          .eq('site_id', site.id)
          .single()

        const findings = report?.findings || []
        const ghostCount = site.ghost_count || 0
        const ambiguousCount = site.ambiguous_count || 0
        const duplicateCount = site.duplicate_count || 0
        const totalInteractive = site.total_interactive || 0
        const clearCount = Math.max(0, totalInteractive - ghostCount - ambiguousCount - duplicateCount)

        return NextResponse.json({
          url: site.url,
          domain: site.domain,
          parityScore: site.parity_score || 0,
          ghostCount,
          categories: {
            ghost: ghostCount,
            ambiguous: ambiguousCount,
            duplicate: duplicateCount,
            clear: clearCount,
          },
          totalInteractive,
          normalScreenshot: report?.normal_screenshot_url || null,
          blackholeScreenshot: report?.blackhole_screenshot_url || null,
          findings,
          cached: true,
        })
      }
    }

    // Site not in database — live scan requires Puppeteer on Vercel
    return NextResponse.json({
      url,
      domain,
      parityScore: 0,
      ghostCount: 0,
      categories: { ghost: 0, ambiguous: 0, duplicate: 0, clear: 0 },
      totalInteractive: 0,
      findings: [],
      normalScreenshot: null,
      blackholeScreenshot: null,
      cached: false,
      message: 'Site not in database. Live scan requires deployment to Vercel.',
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
