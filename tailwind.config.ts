import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16212f',
        line: '#d7dde7',
        canvas: '#f5f7f5',
        surface: '#ffffff',
        brand: {
          50: '#eef8f3',
          100: '#d7f0e3',
          500: '#1b8f65',
          600: '#14734f',
          700: '#105b40',
        },
        accent: {
          50: '#fff7df',
          500: '#e0a400',
          700: '#8a6200',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04)',
        floating: '0 10px 30px rgba(15, 23, 42, 0.10)',
        dialog: '0 24px 64px rgba(15, 23, 42, 0.20)',
        panel: '0 10px 30px rgba(22, 33, 47, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
