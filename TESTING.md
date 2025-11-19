# Guía de Testing

Este documento describe cómo ejecutar y mantener las pruebas unitarias y e2e de la aplicación.

## Instalación

Las dependencias de testing ya están instaladas. Si necesitas reinstalarlas:

```bash
npm install
```

## Estructura de Pruebas

### Pruebas Unitarias

Las pruebas unitarias están organizadas en las mismas estructuras de directorio que el código fuente:

- `src/lib/__tests__/` - Pruebas para utilidades y librerías
- `src/components/__tests__/` - Pruebas para componentes React
- `src/components/auth/__tests__/` - Pruebas específicas de componentes de autenticación
- `src/constants/__tests__/` - Pruebas para constantes
- `src/app/api/**/__tests__/` - Pruebas para rutas de API

### Pruebas E2E

Las pruebas end-to-end están en el directorio `e2e/`:

- `e2e/auth.spec.ts` - Flujos de autenticación
- `e2e/navigation.spec.ts` - Navegación y rutas
- `e2e/digital-assets.spec.ts` - Gestión de assets digitales
- `e2e/dashboard.spec.ts` - Dashboard y resumen
- `e2e/billing.spec.ts` - Facturación y suscripciones

## Ejecutar Pruebas

### Pruebas Unitarias

Ejecutar todas las pruebas unitarias:

```bash
npm run test
```

Ejecutar en modo watch (se ejecutan automáticamente al cambiar archivos):

```bash
npm run test:watch
```

Ejecutar con cobertura de código:

```bash
npm run test:coverage
```

Ejecutar una prueba específica:

```bash
npm run test -- src/lib/__tests__/utils.test.ts
```

### Pruebas E2E

Ejecutar todas las pruebas e2e:

```bash
npm run test:e2e
```

Ejecutar con interfaz gráfica (recomendado para desarrollo):

```bash
npm run test:e2e:ui
```

Ejecutar en modo headed (ver el navegador):

```bash
npm run test:e2e:headed
```

Ejecutar una prueba específica:

```bash
npm run test:e2e -- e2e/auth.spec.ts
```

### Ejecutar Todas las Pruebas

Para ejecutar tanto pruebas unitarias como e2e:

```bash
npm run test:all
```

## Escribir Nuevas Pruebas

### Pruebas Unitarias

Las pruebas unitarias usan Jest y React Testing Library. Ejemplo:

```typescript
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Pruebas E2E

Las pruebas e2e usan Playwright. Ejemplo:

```typescript
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  test('should work correctly', async ({ page }) => {
    await page.goto('/en/my-page');
    await expect(page.getByText('Hello')).toBeVisible();
  });
});
```

## Configuración

### Jest

La configuración de Jest está en `jest.config.js`. Incluye:

- Configuración de Next.js
- Mocks para `next/navigation`, `next-intl`, Supabase, etc.
- Mapeo de rutas `@/*` a `src/*`

### Playwright

La configuración de Playwright está en `playwright.config.ts`. Incluye:

- Navegadores: Chrome, Firefox, Safari
- Servidor de desarrollo automático
- Screenshots y traces en fallos

## Mocks y Setup

Los mocks globales están en `jest.setup.js`:

- `next/navigation` - Router y navegación
- `next-intl` - Internacionalización
- `@/lib/supabase` - Cliente de Supabase
- `sonner` - Sistema de notificaciones

## Mejores Prácticas

1. **Aislamiento**: Cada prueba debe ser independiente
2. **Nombres descriptivos**: Usa nombres que describan lo que prueba
3. **Arrange-Act-Assert**: Organiza las pruebas en estas tres secciones
4. **Mocking**: Mockea dependencias externas (APIs, servicios, etc.)
5. **Cobertura**: Mantén una cobertura de código razonable (>70%)
6. **E2E**: Usa pruebas e2e solo para flujos críticos del usuario

## Troubleshooting

### Problemas con Jest

Si las pruebas fallan por problemas de configuración:

```bash
# Limpiar cache
npm run test -- --clearCache

# Reinstalar dependencias
rm -rf node_modules package-lock.json
npm install
```

### Problemas con Playwright

Si Playwright no encuentra los navegadores:

```bash
npx playwright install
```

### Problemas con Supabase Mocks

Los mocks de Supabase están en `jest.setup.js`. Si necesitas ajustarlos, edita ese archivo.

## CI/CD

Para ejecutar pruebas en CI/CD:

```bash
# Pruebas unitarias
npm run test -- --ci --coverage --maxWorkers=2

# Pruebas e2e
npm run test:e2e -- --reporter=html
```

## Recursos Adicionales

- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)



