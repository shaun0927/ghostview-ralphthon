'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'

export default function Header() {
  const { locale, setLocale } = useLocale()
  const tr = t(locale)

  return (
    <header className="border-b border-card-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-white">{tr.title}</span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">
              {tr.leaderboard}
            </Link>
            <Link href="/scan" className="text-sm text-zinc-400 hover:text-white transition-colors">
              {tr.scan}
            </Link>
            <Link href="/about" className="text-sm text-zinc-400 hover:text-white transition-colors">
              {tr.about}
            </Link>
            <button
              onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
              className="text-sm px-3 py-1 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {locale === 'ko' ? 'EN' : 'KO'}
            </button>
          </nav>
        </div>
      </div>
    </header>
  )
}
