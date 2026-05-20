/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        whatsapp: { bg: '#0b141a', sidebar: '#111b21', chat: '#0b141a', msgOut: '#005c4b', msgIn: '#202c33' },
      },
    },
  },
  plugins: [],
};
