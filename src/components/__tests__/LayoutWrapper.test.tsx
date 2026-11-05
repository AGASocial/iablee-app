import { render, screen } from '@testing-library/react';
import LayoutWrapper from '../LayoutWrapper';
import { useSecurity } from '@/context/SecurityContext';

let pathname = '/dashboard';

jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => pathname,
  Link: ({ children }: { children?: unknown }) => children,
}));

jest.mock('@/context/SecurityContext', () => ({
  useSecurity: jest.fn(),
}));

jest.mock('../security/SecurityPinModal', () => ({
  __esModule: true,
  default: ({ isOpen, forceOpen }: { isOpen: boolean; forceOpen?: boolean }) => (
    <div data-testid="pin-modal" data-open={String(isOpen)} data-force={String(forceOpen)} />
  ),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
  Toaster: () => null,
}));

const mockUseSecurity = useSecurity as jest.Mock;

describe('LayoutWrapper PIN gate', () => {
  beforeEach(() => {
    pathname = '/dashboard';
    mockUseSecurity.mockReturnValue({
      hasPin: true,
      locked: true,
      loading: false,
      checkStatus: jest.fn(),
    });
  });

  function modal() {
    return screen.getByTestId('pin-modal');
  }

  it('forces the PIN modal open on the wizard when the session is locked', () => {
    pathname = '/wizard';
    render(<LayoutWrapper><div>child</div></LayoutWrapper>);

    expect(modal()).toHaveAttribute('data-open', 'true');
    expect(modal()).toHaveAttribute('data-force', 'true');
  });

  it('keeps the PIN modal closed on the dashboard', () => {
    render(<LayoutWrapper><div>child</div></LayoutWrapper>);

    expect(modal()).toHaveAttribute('data-open', 'false');
    expect(modal()).toHaveAttribute('data-force', 'true');
  });
});
