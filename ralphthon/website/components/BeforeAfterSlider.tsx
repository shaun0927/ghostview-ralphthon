'use client'

import { useState, useRef, useCallback } from 'react'
import { useLocale } from '@/lib/locale-context'
import { t } from '@/lib/i18n'

interface BeforeAfterSliderProps {
  normalSrc: string
  blackholeSrc: string
}

export default function BeforeAfterSlider({ normalSrc, blackholeSrc }: BeforeAfterSliderProps) {
  const [split, setSplit] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const { locale } = useLocale()
  const tr = t(locale)

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    setSplit((x / rect.width) * 100)
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons !== 1) return
      handleMove(e.clientX)
    },
    [handleMove],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      handleMove(e.touches[0].clientX)
    },
    [handleMove],
  )

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-zinc-400">
        <span>{tr.humanView}</span>
        <span>{tr.aiView}</span>
      </div>
      <div
        ref={containerRef}
        className="relative w-full aspect-video overflow-hidden rounded-lg border border-card-border cursor-col-resize select-none"
        onMouseMove={handleMouseMove}
        onMouseDown={(e) => handleMove(e.clientX)}
        onTouchMove={handleTouchMove}
        onTouchStart={(e) => handleMove(e.touches[0].clientX)}
      >
        {/* Normal (Human View) - full background */}
        <img
          src={normalSrc}
          alt="Human view"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
        {/* Blackhole (AI View) - clipped from right */}
        <img
          src={blackholeSrc}
          alt="AI view"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          draggable={false}
        />
        {/* Handle bar */}
        <div
          className="absolute top-0 bottom-0 w-[3px] bg-white shadow-lg z-10 pointer-events-none"
          style={{ left: `${split}%`, transform: 'translateX(-50%)' }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 3L2 8L5 13M11 3L14 8L11 13" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        {/* Range input for accessibility */}
        <input
          type="range"
          min="0"
          max="100"
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-col-resize z-20"
          aria-label="Before/After slider"
        />
      </div>
    </div>
  )
}
