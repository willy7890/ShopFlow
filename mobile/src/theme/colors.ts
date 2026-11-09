import { createContext, useContext } from 'react'

export interface ThemeColors {
  accent: string
  accentPressed: string
  accentSurface: string
  accentBorder: string
  accentText: string
  background: string
  surface: string
  surfaceMuted: string
  text: string
  muted: string
  border: string
  danger: string
  success: string
  tab: string
}

export const themeColors: Record<'light' | 'dark', ThemeColors> = {
  light: {
    accent: '#F47B20',
    accentPressed: '#D96312',
    accentSurface: '#FFF5EC',
    accentBorder: '#F9D7BB',
    accentText: '#8E4B19',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#F6F7F9',
    text: '#17191C',
    muted: '#667085',
    border: '#E4E7EC',
    danger: '#B42318',
    success: '#067647',
    tab: '#667085',
  },
  dark: {
    accent: '#FF9B50',
    accentPressed: '#F47B20',
    accentSurface: '#38271B',
    accentBorder: '#694221',
    accentText: '#FFC18D',
    background: '#121416',
    surface: '#1C2024',
    surfaceMuted: '#262B30',
    text: '#F2F4F7',
    muted: '#A0A8B5',
    border: '#383E46',
    danger: '#FDA29B',
    success: '#6CE9A6',
    tab: '#A0A8B5',
  },
}

export interface ThemeContextValue {
  mode: 'light' | 'dark'
  colors: ThemeColors
  setMode: (mode: 'light' | 'dark') => void
  toggleMode: () => Promise<void>
}

export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: themeColors.light,
  setMode: () => undefined,
  toggleMode: async () => undefined,
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
