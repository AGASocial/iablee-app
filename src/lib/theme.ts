/**
 * Sistema de Diseño Centralizado - iablee (Updated for Premium Redesign)
 * 
 * Este archivo contiene toda la configuración de colores, sombras, gradientes
 * y otros elementos de diseño para mantener consistencia en toda la aplicación.
 */

export const theme = {
  // Colores principales
  colors: {
    // Color primario - Royal Blue (Logo Blue)
    primary: {
      medium: '#3b82f6', // Fallback
      DEFAULT: 'oklch(0.55 0.22 260)', // Royal Blue
      dark: 'oklch(0.45 0.22 260)',
      darker: 'oklch(0.35 0.22 260)',
      lightest: 'oklch(0.96 0.05 260)',
      light: 'oklch(0.90 0.10 260)',
    },
    // Color secundario - Soft Slate/Blue tint
    secondary: {
      DEFAULT: 'oklch(0.96 0.02 260)',
      dark: 'oklch(0.85 0.05 260)',
      light: 'oklch(0.98 0.01 260)',
      lightest: '#ffffff',
    },
    // Colores de estado
    success: {
      DEFAULT: 'oklch(0.60 0.20 145)', // Jade
      dark: 'oklch(0.50 0.20 145)',
      light: 'oklch(0.95 0.05 145)',
      text: 'oklch(0.40 0.15 145)',
    },
    warning: {
      DEFAULT: 'oklch(0.70 0.20 85)', // Amber/Orange
      dark: 'oklch(0.60 0.20 85)',
      light: 'oklch(0.95 0.05 85)',
      text: 'oklch(0.45 0.15 85)',
    },
    error: {
      DEFAULT: 'oklch(0.60 0.20 25)', // Red
      dark: 'oklch(0.50 0.20 25)',
      light: 'oklch(0.95 0.05 25)',
      text: 'oklch(0.40 0.15 25)',
    },
    info: {
      DEFAULT: 'oklch(0.60 0.15 230)', // Sky/Blue
      dark: 'oklch(0.50 0.15 230)',
      light: 'oklch(0.95 0.05 230)',
      text: 'oklch(0.40 0.15 230)',
    },
  },

  // Gradientes
  gradients: {
    primary: 'linear-gradient(135deg, oklch(0.55 0.22 260) 0%, oklch(0.45 0.22 260) 100%)', // Royal Blue -> Deep Blue
    primaryLight: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    primaryDark: 'linear-gradient(135deg, oklch(0.45 0.22 260) 0%, oklch(0.35 0.22 260) 100%)',
    success: 'linear-gradient(135deg, oklch(0.60 0.20 145) 0%, oklch(0.50 0.20 145) 100%)',
    card: 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)', // Glass effect
    cardDark: 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)',
    hero: 'radial-gradient(circle at top center, oklch(0.30 0.20 260 / 0.4), transparent 70%)',
  },

  // Sombras
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    DEFAULT: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    md: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    lg: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    xl: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
    primary: '0 10px 15px -3px oklch(0.55 0.22 260 / 0.3), 0 4px 6px -4px oklch(0.55 0.22 260 / 0.2)',
    primaryLg: '0 20px 25px -5px oklch(0.55 0.22 260 / 0.4), 0 8px 10px -6px oklch(0.55 0.22 260 / 0.3)',
    inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
    glow: '0 0 20px oklch(0.55 0.22 260 / 0.5)',
  },

  // Radios de borde
  radius: {
    sm: '0.5rem', // 8px
    DEFAULT: '0.75rem', // 12px
    md: '1rem', // 16px
    lg: '1.5rem', // 24px
    xl: '2rem', // 32px
    '2xl': '2.5rem', // 40px
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
    DEFAULT: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '350ms ease-in-out',
    spring: '500ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

/**
 * Configuración de tema para modo claro
 */
export const lightTheme = {
  background: 'oklch(0.985 0.005 260)',
  foreground: 'oklch(0.15 0.05 260)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.15 0.05 260)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.15 0.05 260)',
  primary: theme.colors.primary.dark,
  primaryForeground: '#ffffff',
  secondary: theme.colors.secondary.DEFAULT,
  secondaryForeground: theme.colors.primary.darker,
  muted: theme.colors.secondary.light,
  mutedForeground: 'oklch(0.50 0.05 260)',
  accent: theme.colors.secondary.DEFAULT,
  accentForeground: theme.colors.primary.darker,
  destructive: theme.colors.error.DEFAULT,
  destructiveForeground: '#ffffff',
  border: 'oklch(0.90 0.02 260)',
  input: 'oklch(0.90 0.02 260)',
  ring: theme.colors.primary.DEFAULT,
} as const;

/**
 * Configuración de tema para modo oscuro
 */
export const darkTheme = {
  background: 'oklch(0.10 0.05 265)',
  foreground: 'oklch(0.92 0.02 265)',
  card: 'oklch(0.14 0.06 265)',
  cardForeground: 'oklch(0.92 0.02 265)',
  popover: 'oklch(0.14 0.06 265)',
  popoverForeground: 'oklch(0.92 0.02 265)',
  primary: theme.colors.primary.DEFAULT,
  primaryForeground: '#ffffff',
  secondary: 'oklch(0.20 0.08 265)',
  secondaryForeground: 'oklch(0.92 0.02 265)',
  muted: 'oklch(0.20 0.06 265)',
  mutedForeground: 'oklch(0.65 0.05 265)',
  accent: 'oklch(0.20 0.08 265)',
  accentForeground: 'oklch(0.98 0.01 260)',
  destructive: theme.colors.error.DEFAULT,
  destructiveForeground: '#ffffff',
  border: 'oklch(0.22 0.06 265)',
  input: 'oklch(0.22 0.06 265)',
  ring: theme.colors.primary.DEFAULT,
} as const;

export type Theme = typeof theme;
