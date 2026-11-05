import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DashboardClient from "../DashboardClient";
import type { DashboardData } from "@/hooks/useDataQueries";

const mockUseDashboard = jest.fn();
const mockUseSecuritySession = jest.fn();

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

jest.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock("@/hooks/useDataQueries", () => ({
  useDashboard: (...args: unknown[]) => mockUseDashboard(...args),
  useSecuritySession: (...args: unknown[]) => mockUseSecuritySession(...args),
  useInvalidateData: () => ({
    invalidateDashboard: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@/components/dashboard/DashboardOnboardingChecklist", () => ({
  __esModule: true,
  default: ({ hasPin }: { hasPin: boolean }) => (
    <div data-testid="dashboard-checklist" data-haspin={String(hasPin)} />
  ),
}));

const dashboardData: DashboardData = {
  assets: [
    {
      id: "asset-1",
      asset_name: "Asset 1",
      asset_type: "Document",
      status: "active",
      user_id: "user-1",
      asset_type_details: {
        id: "document",
        name: "Document",
        description: "Document asset",
        icon: "file",
      },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  beneficiaries: [
    {
      id: "beneficiary-1",
      full_name: "Beneficiary 1",
      email: "beneficiary@example.com",
      relationship: null,
      relationship_id: null,
      phone_number: null,
      notes: null,
      status: "active",
      notified: false,
      last_notified_at: null,
      email_verified: false,
      email_verified_at: null,
    },
  ],
  stats: {
    totalAssets: 1,
    totalBeneficiaries: 1,
    protectedAssets: 1,
    recentActivity: 1,
  },
};

describe("DashboardClient checklist behavior with security query errors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDashboard.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    });
  });

  it("does not show onboarding checklist as missing PIN when security session query fails", () => {
    mockUseSecuritySession.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<DashboardClient />);

    expect(screen.queryByTestId("dashboard-checklist")).not.toBeInTheDocument();
  });

  it("treats PIN as unknown (not pending) while security session fails", () => {
    mockUseSecuritySession.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    mockUseDashboard.mockReturnValue({
      data: {
        ...dashboardData,
        stats: {
          ...dashboardData.stats,
          totalAssets: 0,
        },
      },
      isLoading: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    });

    render(<DashboardClient />);

    expect(screen.getByTestId("dashboard-checklist")).toHaveAttribute("data-haspin", "true");
  });
});
