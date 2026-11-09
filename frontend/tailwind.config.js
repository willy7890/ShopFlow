/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)', sf: 'rgb(var(--sf-rgb) / <alpha-value>)', tx: 'rgb(var(--tx-rgb) / <alpha-value>)', mu: 'rgb(var(--mu-rgb) / <alpha-value>)', bd: 'rgb(var(--bd-rgb) / <alpha-value>)',
        ac: 'rgb(var(--ac-rgb) / <alpha-value>)', ac2: 'rgb(var(--ac2-rgb) / <alpha-value>)', on: 'rgb(var(--on-rgb) / <alpha-value>)', er: 'rgb(var(--er-rgb) / <alpha-value>)', ok: 'rgb(var(--ok-rgb) / <alpha-value>)',
      },
      fontFamily: { sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
}
