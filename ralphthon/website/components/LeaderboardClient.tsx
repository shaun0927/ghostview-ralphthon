'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'
import { Site, Stats } from '@/lib/types'
import HeroMessage from './HeroMessage'

type SortKey = 'parity_score' | 'ghost_count'
type SortDir = 'asc' | 'desc'

function scoreColor(score: number): string {
  if (score < 50) return 'text-ghost'
  if (score < 80) return 'text-ambiguous'
  return 'text-clear'
}

function categoryLabel(cat: string, locale: 'ko' | 'en'): string {
  const map: Record<string, { ko: string; en: string }> = {
    portal: { ko: '포털', en: 'Portal' },
    government: { ko: '정부', en: 'Government' },
    education: { ko: '교육', en: 'Education' },
    news: { ko: '뉴스', en: 'News' },
    commerce: { ko: '커머스', en: 'Commerce' },
    general: { ko: '기타', en: 'General' },
  }
  return map[cat]?.[locale] || cat
}

interface Props {
  sites: Site[]
  stats: Stats
}

export default function LeaderboardClient({ sites, stats }: Props) {
  const { locale } = useLocale()
  const tr = t(locale)
  const [sortKey, setSortKey] = useState<SortKey>('parity_score')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterCat, setFilterCat] = useState<string>('all')

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(sites.map((s) => s.category)))],
    [sites],
  )

  const sorted = useMemo(() => {
    let filtered = filterCat === 'all' ? sites : sites.filter((s) => s.category === filterCat)
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [sites, sortKey, sortDir, filterCat])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3">{tr.title}</h1>
        <p className="text-lg text-zinc-400">{tr.subtitle}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-card-border rounded-xl p-6 text-center">
          <div className="text-3xl font-bold text-white">{stats.totalSites.toLocaleString()}</div>
          <div className="text-sm text-zinc-400 mt-1">{tr.scannedSites}</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-6 text-center">
          <div className={`text-3xl font-bold ${scoreColor(stats.avgParity)}`}>
            {stats.avgParity.toFixed(1)}%
          </div>
          <div className="text-sm text-zinc-400 mt-1">{tr.avgParity}</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-6 text-center">
          <div className="text-3xl font-bold text-ghost">{stats.totalGhosts.toLocaleString()}</div>
          <div className="text-sm text-zinc-400 mt-1">{tr.totalGhosts}</div>
        </div>
      </div>

      {/* Hero Message */}
      <HeroMessage />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              filterCat === cat
                ? 'border-white text-white bg-zinc-800'
                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {cat === 'all' ? tr.all : categoryLabel(cat, locale)}
          </button>
        ))}
      </div>

      {/* Leaderboard Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-zinc-400">
                <th className="text-left px-4 py-3 font-medium">{tr.rank}</th>
                <th className="text-left px-4 py-3 font-medium">{tr.domain}</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{tr.category}</th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort('parity_score')}
                >
                  {tr.parityScore}{arrow('parity_score')}
                </th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort('ghost_count')}
                >
                  {tr.ghostCount}{arrow('ghost_count')}
                </th>
                <th className="text-center px-4 py-3 font-medium">{tr.detail}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((site, i) => (
                <tr key={site.id} className="border-b border-card-border/50 hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <span className="text-white font-medium">{site.domain}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 hidden sm:table-cell">
                    {categoryLabel(site.category, locale)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${scoreColor(site.parity_score)}`}>
                    {site.parity_score.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ghost">
                    {site.ghost_count}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {site.has_report ? (
                      <Link
                        href={`/site/${site.domain}`}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {tr.viewDetail}
                      </Link>
                    ) : (
                      <span className="text-zinc-600">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
