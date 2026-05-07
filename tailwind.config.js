/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
        // Cinema-dark surface ramp. 0 = deepest, 900 = brightest layer.
        surface: {
          0:   '#000000',
          50:  '#070708',
          100: '#0a0a0b',
          150: '#0d0d0f',
          200: '#111114',
          300: '#15161a',
          400: '#1a1c21',
          500: '#22252b',
          600: '#2c2f37',
          700: '#3a3e48',
          800: '#4d525e',
          900: '#666c79',
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
      },
      boxShadow: {
        'glow': '0 0 0 1px rgba(255,255,255,0.06), 0 12px 32px -8px rgba(0,0,0,0.6)',
        'card': '0 2px 8px -2px rgba(0,0,0,0.4)',
        'card-hover': '0 18px 40px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(34,197,94,0.18)',
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
  plugins: [],
}
