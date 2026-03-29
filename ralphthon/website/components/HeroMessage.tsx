'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'

export default function HeroMessage() {
  const [expanded, setExpanded] = useState(true)
  const { locale } = useLocale()
  const tr = t(locale)

  return (
    <div className="bg-card border border-card-border rounded-xl p-6 mb-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold text-zinc-200">
          {locale === 'ko' ? '왜 이것이 중요한가' : 'Why This Matters'}
        </h2>
        <span className="text-zinc-500 text-xl">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="mt-4 text-sm text-zinc-400 leading-relaxed whitespace-pre-line">
          {tr.heroMessage.split('\n').map((line, i) => {
            const bold = locale === 'ko'
              ? ['간판이 없으면', '존재하지 않습니다', '시각장애인처럼']
              : ["doesn't exist", 'blind person', 'No signage']
            let node: React.ReactNode = line
            for (const keyword of bold) {
              if (line.includes(keyword)) {
                const parts = line.split(keyword)
                node = (
                  <>
                    {parts[0]}
                    <strong className="text-white">{keyword}</strong>
                    {parts.slice(1).join(keyword)}
                  </>
                )
                break
              }
            }
            return <p key={i} className={line === '' ? 'h-3' : ''}>{node}</p>
          })}
        </div>
      )}
    </div>
  )
}
