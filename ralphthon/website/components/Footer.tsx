'use client'

import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'

export default function Footer() {
  const { locale } = useLocale()
  const tr = t(locale)

  return (
    <footer className="border-t border-card-border bg-card/50 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span>{tr.madeWith}</span>
            <a
              href="https://github.com/shaun0927/openchrome"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
            >
              <img
                src="https://raw.githubusercontent.com/shaun0927/openchrome/main/assets/icon.png"
                alt="OpenChrome"
                width={20}
                height={20}
                className="rounded"
              />
              OpenChrome
            </a>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <a
              href="https://github.com/shaun0927/ghostview"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
