/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        google: {
          blue: '#1a73e8',
          blueHover: '#1557b0',
          blueLight: '#e8f0fe',
          blueBorder: '#d2e3fc',
          red: '#d93025',
          yellow: '#f9ab00',
          green: '#1e8e3e',
          greenLight: '#e6f4ea',
          gray: {
            50: '#f8f9fa',
            100: '#f1f3f4',
            200: '#e8eaed',
            300: '#dadce0',
            400: '#bdc1c6',
            500: '#9aa0a6',
            600: '#70757a',
            700: '#5f6368',
            800: '#3c4043',
            900: '#202124',
          }
        }
      },
      fontFamily: {
        sans: ['Google Sans', 'Roboto', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
