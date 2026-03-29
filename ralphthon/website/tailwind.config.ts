import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        card: '#141414',
        'card-border': '#1e1e1e',
        ghost: '#ef4444',
        ambiguous: '#f97316',
        duplicate: '#eab308',
        clear: '#22c55e',
      },
    },
  },
  plugins: [],
}
export default config
