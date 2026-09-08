const forms = require('@tailwindcss/forms');
const containerQueries = require('@tailwindcss/container-queries');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./runtime.html', './src/**/*.{ts,css}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#07090C',
          900: '#0C0E12',
          850: '#12151B',
          800: '#161A22',
          750: '#1D222C',
          700: '#252B37',
          600: '#343D4E',
          500: '#4B5569',
        },
        amber: {
          350: '#FFC837',
          400: '#FFB800',
          450: '#F59E0B',
          500: '#E5A93C',
          600: '#D4AF37',
          700: '#B8860B',
          900: '#4E3807',
        },
        gold: {
          light: '#F5E2B3',
          base: '#D4AF37',
          dim: '#8A7326',
          deep: '#3A2E0B',
        },
        indGreen: '#22C55E',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Share Tech Mono', 'monospace'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Plus Jakarta Sans',
          'PingFang SC',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [forms, containerQueries],
};
