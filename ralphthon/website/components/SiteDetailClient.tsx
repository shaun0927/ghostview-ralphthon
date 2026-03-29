'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/locale-context'
import { t, localized } from '@/lib/i18n'
import { Site, Report, Finding } from '@/lib/types'
import BeforeAfterSlider from './BeforeAfterSlider'

function severityBadge(severity: Finding['severity']) {
  const colors = {
    ghost: 'bg-ghost/20 text-ghost border-ghost/30',
    ambiguous: 'bg-ambiguous/20 text-ambiguous border-ambiguous/30',
    duplicate: 'bg-duplicate/20 text-duplicate border-duplicate/30',
  }
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[severity]}`}>
      {severity.toUpperCase()}
    </span>
  )
}

function scoreColor(score: number): string {
  if (score < 50) return 'text-ghost'
  if (score < 80) return 'text-ambiguous'
  return 'text-clear'
}

interface Props {
  site: Site
  report: Report | null
}

export default function SiteDetailClient({ site, report }: Props) {
  const { locale } = useLocale()
  const tr = t(locale)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const copyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  const findings: Finding[] = report?.findings || []

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back */}
      <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors mb-6 inline-block">
        &larr; {tr.leaderboard}
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{site.domain}</h1>
        <a
          href={site.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          {site.url}
        </a>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className={`text-2xl font-bold ${scoreColor(site.parity_score)}`}>
            {site.parity_score.toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-400 mt-1">Parity Score</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-ghost">{site.ghost_count}</div>
          <div className="text-xs text-zinc-400 mt-1">Ghost</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-ambiguous">{site.ambiguous_count}</div>
          <div className="text-xs text-zinc-400 mt-1">Ambiguous</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-duplicate">{site.duplicate_count}</div>
          <div className="text-xs text-zinc-400 mt-1">Duplicate</div>
        </div>
      </div>

      {/* Category Bar */}
      <div className="bg-card border border-card-border rounded-xl p-4 mb-8">
        <div className="flex h-4 rounded-full overflow-hidden">
          {site.total_interactive > 0 && (
            <>
              <div
                className="bg-ghost"
                style={{ width: `${(site.ghost_count / site.total_interactive) * 100}%` }}
              />
              <div
                className="bg-ambiguous"
                style={{ width: `${(site.ambiguous_count / site.total_interactive) * 100}%` }}
              />
              <div
                className="bg-duplicate"
                style={{ width: `${(site.duplicate_count / site.total_interactive) * 100}%` }}
              />
              <div className="bg-clear flex-1" />
            </>
          )}
        </div>
        <div className="flex justify-between mt-2 text-xs text-zinc-400">
          <span className="text-ghost">Ghost: {site.ghost_count}</span>
          <span className="text-ambiguous">Ambiguous: {site.ambiguous_count}</span>
          <span className="text-duplicate">Duplicate: {site.duplicate_count}</span>
          <span className="text-clear">
            Clear: {site.total_interactive - site.ghost_count - site.ambiguous_count - site.duplicate_count}
          </span>
        </div>
      </div>

      {/* Before/After Slider */}
      {report?.normal_screenshot_url && report?.blackhole_screenshot_url ? (
        <div className="mb-8">
          <BeforeAfterSlider
            normalSrc={report.normal_screenshot_url}
            blackholeSrc={report.blackhole_screenshot_url}
          />
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl p-8 mb-8 text-center text-zinc-500">
          {tr.noReport}
        </div>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">{tr.findings}</h2>
          <div className="space-y-4">
            {findings.map((finding, i) => (
              <div
                key={i}
                className="bg-card border border-card-border rounded-xl p-5"
              >
                <div className="flex items-center gap-3 mb-3">
                  {severityBadge(finding.severity)}
                  <h3 className="font-semibold text-white">
                    {localized(finding.title, locale)}
                  </h3>
                </div>
                <p className="text-sm text-zinc-400 mb-2">
                  {finding.elementInfo}
                </p>
                <p className="text-sm text-zinc-300 mb-3">
                  {localized(finding.description, locale)}
                </p>
                {finding.impact && (
                  <p className="text-sm text-zinc-400 mb-3 italic">
                    {localized(finding.impact, locale)}
                  </p>
                )}

                {/* Finding Screenshots */}
                {finding.screenshots?.normal && finding.screenshots?.ghost && (
                  <div className="mb-3">
                    <BeforeAfterSlider
                      normalSrc={finding.screenshots.normal}
                      blackholeSrc={finding.screenshots.ghost}
                    />
                  </div>
                )}

                {/* Fix Code */}
                {finding.fix?.code && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-400 font-medium">
                        {localized(finding.fix.label, locale) || tr.fixCode}
                      </span>
                      <button
                        onClick={() => copyCode(finding.fix.code, i)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        {copiedIdx === i ? tr.copied : tr.copy}
                      </button>
                    </div>
                    <pre className="bg-bg border border-card-border rounded-lg p-3 text-xs text-zinc-300 overflow-x-auto">
                      <code>{finding.fix.code}</code>
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
