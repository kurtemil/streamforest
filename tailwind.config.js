/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // A `hover:` class that sticks after a tap is worse than no hover state at all.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      screens: {
        // Reveal-on-hover is a property of the input device, not the viewport
        // width. Gating it on `md:` hid card controls on an iPad — a touch screen
        // wide enough to get the desktop layout — where they could never be
        // revealed at all.
        'can-hover': { raw: '(hover: hover) and (pointer: fine)' },
      },
      colors: {
        // Emerald, not the stock Tailwind green. The old ramp was `green`
        // straight out of the box — the most common accent on the web — and it
        // did not match the mark, which is built from #6ee7b7 → #10b981.
        accent: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        // Cinema-dark surface ramp. 0 = deepest, 900 = brightest layer.
        //
        // Biased a few points toward green rather than pure neutral grey. At this
        // depth it never reads as "green" — it reads as chosen, where #0a0a0b
        // read as the default dark mode of any framework.
        surface: {
          0:   '#000000',
          50:  '#050907',
          100: '#080d0b',
          150: '#0b110f',
          200: '#0e1614',
          300: '#131d1a',
          400: '#182420',
          500: '#202e29',
          600: '#2a3b35',
          700: '#384b44',
          800: '#4b5f57',
          900: '#66796f',
        },
        // For warnings / destructive / alt CTAs in player chrome
        warn: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
        display: ['"Inter Variable"', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // Display (heroes, big titles)
        'display-2xl': ['clamp(3rem, 6vw, 5rem)',  { lineHeight: '1.02', letterSpacing: '-0.04em', fontWeight: '800' }],
        'display-xl':  ['clamp(2.25rem, 4.5vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '800' }],
        'display-lg':  ['clamp(1.75rem, 3vw, 2.5rem)',   { lineHeight: '1.1',  letterSpacing: '-0.025em', fontWeight: '700' }],
        // Headings
        'heading-xl':  ['1.5rem',  { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '700' }],
        'heading-lg':  ['1.25rem', { lineHeight: '1.3',  letterSpacing: '-0.015em', fontWeight: '600' }],
        'heading-md':  ['1.0625rem', { lineHeight: '1.35', letterSpacing: '-0.01em', fontWeight: '600' }],
        // Body / labels
        'body-lg':     ['1rem',    { lineHeight: '1.55' }],
        'body':        ['0.875rem', { lineHeight: '1.5' }],
        'caption':     ['0.75rem', { lineHeight: '1.45', letterSpacing: '0.01em' }],
        'micro':       ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.04em' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '15': '3.75rem',
        '18': '4.5rem',
      },
      borderRadius: {
        'xl2': '1.125rem',
        // Artwork wants a generous corner. 8px on a poster reads as a 2019
        // thumbnail; the card radius is now a token so it stays consistent.
        'card': '0.875rem',
        'card-lg': '1.25rem',
      },
      boxShadow: {
        'glow': '0 0 0 1px rgba(255,255,255,0.06), 0 12px 32px -8px rgba(0,0,0,0.6)',
        // Cards sat flat on the ground with a 2px shadow nothing could see. They
        // now carry a lit top edge and a shadow deep enough to separate artwork
        // from the black behind it.
        'card': '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 4px 16px -4px rgba(0,0,0,0.7)',
        'card-hover': '0 1px 0 0 rgba(255,255,255,0.10) inset, 0 24px 48px -16px rgba(0,0,0,0.9), 0 0 0 1px rgba(52,211,153,0.35)',
        'cinema': '0 30px 80px -20px rgba(0,0,0,0.85)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s var(--ease-out)',
        'slide-up': 'slideUp 0.35s var(--ease-out)',
        'shimmer': 'shimmer 1.6s linear infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'kenburns': 'kenburns 18s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseSoft: { '0%, 100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
        kenburns: {
          '0%, 100%': { transform: 'scale(1.05) translate(0, 0)' },
          '50%':      { transform: 'scale(1.12) translate(-1.5%, -1%)' },
        },
      },
      transitionTimingFunction: {
        'out-expo':   'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-quart':  'cubic-bezier(0.25, 1, 0.5, 1)',
        'spring':     'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        // The viewport is declared `viewport-fit=cover` with a translucent status
        // bar, so the app draws under the notch and the home indicator and owes
        // itself these insets. Landscape matters here as much as portrait — it is
        // the orientation people actually watch films in.
        '.pb-safe': { paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
        '.pt-safe': { paddingTop: 'env(safe-area-inset-top, 0px)' },
        '.pl-safe': { paddingLeft: 'env(safe-area-inset-left, 0px)' },
        '.pr-safe': { paddingRight: 'env(safe-area-inset-right, 0px)' },
        '.px-safe': {
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        },
        '.mb-safe': { marginBottom: 'env(safe-area-inset-bottom, 0px)' },
      })
    },
  ],
}
