import { supabase } from '@/lib/supabase'
import { MOCK_SITES } from '@/lib/mock-data'
import SiteDetailClient from '@/components/SiteDetailClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ domain: string }>
}

async function getSiteData(domain: string) {
  if (!supabase) {
    const site = MOCK_SITES.find((s) => s.domain === domain) || MOCK_SITES[0]
    return { site, report: null }
  }

  try {
    const { data: site } = await supabase
      .from('sites')
      .select('*')
      .eq('domain', domain)
      .single()

    if (!site) {
      const fallback = MOCK_SITES.find((s) => s.domain === domain) || MOCK_SITES[0]
      return { site: fallback, report: null }
    }

    const { data: report } = await supabase
      .from('reports')
      .select('*')
      .eq('domain', domain)
      .single()

    return { site, report }
  } catch {
    const fallback = MOCK_SITES.find((s) => s.domain === domain) || MOCK_SITES[0]
    return { site: fallback, report: null }
  }
}

export default async function SiteDetailPage({ params }: PageProps) {
  const { domain } = await params
  const decoded = decodeURIComponent(domain)
  const { site, report } = await getSiteData(decoded)
  return <SiteDetailClient site={site} report={report} />
}
