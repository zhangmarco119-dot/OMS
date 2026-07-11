import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16212f',
        line: '#d7dde7',
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
        panel: '0 18px 50px rgba(22, 33, 47, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
