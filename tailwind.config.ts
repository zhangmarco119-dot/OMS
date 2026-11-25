import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16212f',
        line: '#d7dde7',
        canvas: '#f4f7f5',
        surface: '#ffffff',
        brand: {
          50: '#eef8f3',
          100: '#d7f0e3',
          200: '#b3e2cc',
          300: '#7cccaa',
          500: '#1b8f65',
          600: '#14734f',
          700: '#105b40',
          800: '#0d4a34',
        },
        accent: {
          50: '#fff7df',
          500: '#e0a400',
          700: '#8a6200',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px -4px rgba(15, 23, 42, 0.04)',
        'card-hover': '0 8px 24px -8px rgba(20, 115, 79, 0.14), 0 2px 6px -2px rgba(15, 23, 42, 0.05)',
        floating: '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 10px -2px rgba(15, 23, 42, 0.05)',
        dialog: '0 24px 64px rgba(15, 23, 42, 0.22)',
        panel: '0 10px 30px rgba(22, 33, 47, 0.08)',
        nav: '0 -8px 28px rgba(15, 23, 42, 0.07)',
      },
    },
  },
  plugins: [],
};

export default config;
