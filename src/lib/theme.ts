/**
 * Sistema de Diseño Centralizado - iablee
 * 
 * Este archivo contiene toda la configuración de colores, sombras, gradientes
 * y otros elementos de diseño para mantener consistencia en toda la aplicación.
 */

export const theme = {
  // Colores principales
  colors: {
    // Color primario - Índigo vibrante y moderno
    primary: {
      medium: '#6366f1', // indigo-500
      DEFAULT: '#4f46e5', // indigo-600
      dark: '#4338ca', // indigo-700
      darker: '#3730a3', // indigo-800
      lightest: '#eef2ff', // indigo-50
      light: '#e0e7ff', // indigo-100
    },
    // Color secundario - Verde esmeralda
    secondary: {
      DEFAULT: '#10b981', // emerald-500
      dark: '#059669', // emerald-600
      light: '#d1fae5', // emerald-100
      lightest: '#ecfdf5', // emerald-50
    },
    // Colores de estado
    success: {
      DEFAULT: '#10b981', // emerald-500
      dark: '#059669', // emerald-600
      light: '#d1fae5', // emerald-100
      text: '#065f46', // emerald-800
    },
    warning: {
      DEFAULT: '#f59e0b', // amber-500
      dark: '#d97706', // amber-600
      light: '#fef3c7', // amber-100
      text: '#92400e', // amber-800
    },
    error: {
      DEFAULT: '#ef4444', // red-500
      dark: '#dc2626', // red-600
      light: '#fee2e2', // red-100
      text: '#991b1b', // red-800
    },
    info: {
      DEFAULT: '#3b82f6', // blue-500
      dark: '#2563eb', // blue-600
      light: '#dbeafe', // blue-100
      text: '#1e40af', // blue-800
    },
  },

  // Gradientes
  gradients: {
    primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    primaryLight: 'linear-gradient(135deg, #eef2ff 0%, #ede9fe 100%)',
    primaryDark: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
    success: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    card: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    cardDark: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    hero: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
  },

  // Sombras
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    primary: '0 10px 15px -3px rgba(99, 102, 241, 0.3), 0 4px 6px -4px rgba(99, 102, 241, 0.2)',
    primaryLg: '0 20px 25px -5px rgba(99, 102, 241, 0.3), 0 8px 10px -6px rgba(99, 102, 241, 0.2)',
    inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  },

  // Radios de borde
  radius: {
    sm: '0.375rem', // 6px
    DEFAULT: '0.5rem', // 8px
    md: '0.625rem', // 10px
    lg: '0.75rem', // 12px
    xl: '1rem', // 16px
    '2xl': '1.5rem', // 24px
    full: '9999px',
  },

  // Espaciado
  spacing: {
    xs: '0.5rem', // 8px
    sm: '0.75rem', // 12px
    DEFAULT: '1rem', // 16px
    md: '1.5rem', // 24px
    lg: '2rem', // 32px
    xl: '3rem', // 48px
    '2xl': '4rem', // 64px
  },

  // Transiciones
  transitions: {
    fast: '150ms ease-in-out',
    DEFAULT: '200ms ease-in-out',
    slow: '300ms ease-in-out',
    spring: '400ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

/**
 * Configuración de tema para modo claro
 */
export const lightTheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  card: '#ffffff',
  cardForeground: '#0f172a',
  popover: '#ffffff',
  popoverForeground: '#0f172a',
  primary: theme.colors.primary.DEFAULT,
  primaryForeground: '#ffffff',
  secondary: '#f1f5f9',
  secondaryForeground: '#0f172a',
  muted: '#f1f5f9',
  mutedForeground: '#64748b',
  accent: '#f8fafc',
  accentForeground: '#0f172a',
  destructive: theme.colors.error.DEFAULT,
  destructiveForeground: '#ffffff',
  border: '#e2e8f0',
  input: '#e2e8f0',
  ring: theme.colors.primary.DEFAULT,
} as const;

/**
 * Configuración de tema para modo oscuro
 */
export const darkTheme = {
  background: '#0f172a',
  foreground: '#f8fafc',
  card: '#1e293b',
  cardForeground: '#f8fafc',
  popover: '#1e293b',
  popoverForeground: '#f8fafc',
  primary: theme.colors.primary.light,
  primaryForeground: '#ffffff',
  secondary: '#1e293b',
  secondaryForeground: '#f8fafc',
  muted: '#334155',
  mutedForeground: '#94a3b8',
  accent: '#1e293b',
  accentForeground: '#f8fafc',
  destructive: theme.colors.error.DEFAULT,
  destructiveForeground: '#ffffff',
  border: '#334155',
  input: '#334155',
  ring: theme.colors.primary.light,
} as const;

export type Theme = typeof theme;
