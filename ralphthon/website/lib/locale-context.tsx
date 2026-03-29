'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { Locale } from './i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'ko',
  setLocale: () => {},
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ko')
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
