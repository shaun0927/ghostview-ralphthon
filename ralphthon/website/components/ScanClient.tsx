'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'
import BeforeAfterSlider from './BeforeAfterSlider'

interface ScanResult {
  url: string
  domain: string
  parityScore: number
  ghostCount: number
  categories: { ghost: number; ambiguous: number; duplicate: number; clear: number }
  totalInteractive: number
  normalScreenshot?: string
  blackholeScreenshot?: string
  findings: Array<{
    severity: 'ghost' | 'ambiguous' | 'duplicate'
    title: string
    description: string
    fix: { label: string; code: string }
  }>
}

function scoreColor(score: number): string {
  if (score < 50) return 'text-ghost'
  if (score < 80) return 'text-ambiguous'
  return 'text-clear'
}

export default function ScanClient() {
  const { locale } = useLocale()
  const tr = t(locale)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleScan = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })

      if (!res.ok) {
        throw new Error(`Scan failed: ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold mb-2">{tr.scanTitle}</h1>
      <p className="text-zinc-400 mb-8">
        {locale === 'ko'
          ? 'URL을 입력하면 실시간으로 접근성 감사를 수행합니다.'
          : 'Enter a URL to run a real-time accessibility audit.'}
      </p>

      {/* Scan Form */}
      <div className="flex gap-3 mb-8">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          placeholder={tr.scanPlaceholder}
          className="flex-1 bg-card border border-card-border rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          disabled={loading}
        />
        <button
          onClick={handleScan}
          disabled={loading || !url.trim()}
          className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? tr.scanning : tr.scanButton}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <div className="inline-block w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-zinc-400">{tr.scanning}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-ghost/10 border border-ghost/30 rounded-xl p-4 text-ghost text-sm">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-6">
          {/* Score Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-card-border rounded-xl p-4 text-center">
              <div className={`text-3xl font-bold ${scoreColor(result.parityScore)}`}>
                {result.parityScore.toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-400 mt-1">Parity Score</div>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-ghost">{result.ghostCount}</div>
              <div className="text-xs text-zinc-400 mt-1">Ghost Elements</div>
            </div>
          </div>

          {/* Category Bar */}
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex h-4 rounded-full overflow-hidden">
              {result.totalInteractive > 0 && (
                <>
                  <div className="bg-ghost" style={{ width: `${(result.categories.ghost / result.totalInteractive) * 100}%` }} />
                  <div className="bg-ambiguous" style={{ width: `${(result.categories.ambiguous / result.totalInteractive) * 100}%` }} />
                  <div className="bg-duplicate" style={{ width: `${(result.categories.duplicate / result.totalInteractive) * 100}%` }} />
                  <div className="bg-clear flex-1" />
                </>
              )}
            </div>
          </div>

          {/* Before/After Slider */}
          {result.normalScreenshot && result.blackholeScreenshot && (
            <BeforeAfterSlider
              normalSrc={result.normalScreenshot}
              blackholeSrc={result.blackholeScreenshot}
            />
          )}

          {/* Findings */}
          {result.findings.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-bold">{tr.findings}</h2>
              {result.findings.map((f, i) => (
                <div key={i} className="bg-card border border-card-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded border ${
                        f.severity === 'ghost'
                          ? 'bg-ghost/20 text-ghost border-ghost/30'
                          : f.severity === 'ambiguous'
                            ? 'bg-ambiguous/20 text-ambiguous border-ambiguous/30'
                            : 'bg-duplicate/20 text-duplicate border-duplicate/30'
                      }`}
                    >
                      {f.severity.toUpperCase()}
                    </span>
                    <span className="font-medium text-white">{f.title}</span>
                  </div>
                  <p className="text-sm text-zinc-400 mb-2">{f.description}</p>
                  {f.fix?.code && (
                    <pre className="bg-bg border border-card-border rounded-lg p-3 text-xs text-zinc-300 overflow-x-auto">
                      <code>{f.fix.code}</code>
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
