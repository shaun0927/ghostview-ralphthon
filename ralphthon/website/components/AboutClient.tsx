'use client'

import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'

export default function AboutClient() {
  const { locale } = useLocale()
  const tr = t(locale)

  const levels = [
    {
      title: tr.ghostLevel,
      desc: tr.ghostDesc,
      color: 'border-ghost/30 bg-ghost/5',
      badge: 'bg-ghost/20 text-ghost',
    },
    {
      title: tr.ambiguousLevel,
      desc: tr.ambiguousDesc,
      color: 'border-ambiguous/30 bg-ambiguous/5',
      badge: 'bg-ambiguous/20 text-ambiguous',
    },
    {
      title: tr.duplicateLevel,
      desc: tr.duplicateDesc,
      color: 'border-duplicate/30 bg-duplicate/5',
      badge: 'bg-duplicate/20 text-duplicate',
    },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold mb-4">{tr.aboutTitle}</h1>
      <p className="text-lg text-zinc-400 mb-10">{tr.aboutDescription}</p>

      <h2 className="text-2xl font-bold mb-6">{tr.methodology}</h2>
      <div className="space-y-4 mb-12">
        {levels.map((level) => (
          <div
            key={level.title}
            className={`border rounded-xl p-5 ${level.color}`}
          >
            <h3 className="font-semibold text-white mb-2">{level.title}</h3>
            <p className="text-sm text-zinc-300">{level.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6 text-center">
        <p className="text-zinc-400 mb-4">{tr.poweredBy}</p>
        <div className="flex justify-center gap-6">
          <a
            href="https://github.com/shaun0927/openchrome"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            OpenChrome
          </a>
          <a
            href="https://github.com/shaun0927/ghostview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            GhostView
          </a>
        </div>
      </div>
    </div>
  )
}
