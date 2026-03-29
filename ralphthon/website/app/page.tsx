import { supabase } from '@/lib/supabase'
import { Site, Stats } from '@/lib/types'
import { MOCK_SITES, MOCK_STATS } from '@/lib/mock-data'
import LeaderboardClient from '@/components/LeaderboardClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getData(): Promise<{ sites: Site[]; stats: Stats }> {
  if (!supabase) return { sites: MOCK_SITES, stats: MOCK_STATS }

  try {
    const { data: sites, error } = await supabase
      .from('sites')
      .select('*')
      .order('parity_score', { ascending: true })

    if (error || !sites || sites.length === 0) {
      return { sites: MOCK_SITES, stats: MOCK_STATS }
    }

    const stats: Stats = {
      totalSites: sites.length,
      avgParity: Math.round(sites.reduce((a, s) => a + (s.parity_score || 0), 0) / sites.length * 10) / 10,
      totalGhosts: sites.reduce((a, s) => a + (s.ghost_count || 0), 0),
    }

    return { sites, stats }
  } catch {
    return { sites: MOCK_SITES, stats: MOCK_STATS }
  }
}

export default async function Home() {
  const { sites, stats } = await getData()
  return <LeaderboardClient sites={sites} stats={stats} />
}
