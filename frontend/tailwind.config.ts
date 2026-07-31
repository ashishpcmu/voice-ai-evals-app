import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // BAIS-aligned palette. Token names kept stable (e.g. `primary-blue`)
        // for backwards compatibility — only the underlying values changed.
        'primary-blue': '#016D6A',   // BAIS primary action color (deep teal)
        'dark-navy':    '#0D3B39',   // BAIS sidebar (deep forest teal — used as gradient start)
        'dark-navy-2':  '#0E3938',   // BAIS sidebar gradient end
        'accent-teal':  '#8B5CF6',   // BAIS accent (violet / purple)
        'light-blue':   '#E6F4F2',   // soft mint tint paired with deep teal primary
        'brand-white':  '#FFFFFF',
        'dark-text':    '#111827',
        'gray-text':    '#6B7280',
        'brand-border': '#E5E7EB',
        'success-green': '#059669',
        'warning-amber': '#D97706',
        'error-red':     '#DC2626',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
