import { render, screen } from "@testing-library/react";
import DashboardOnboardingChecklist from "../DashboardOnboardingChecklist";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    const messages: Record<string, string> = {
      dashboardChecklistTitle: "Checklist",
      dashboardChecklistDescription: "Description",
      dashboardChecklistProgress: `${values?.completed} of ${values?.total} completed`,
      dashboardChecklistProgressAria: `${values?.progress}% progress completed`,
      dashboardChecklistStepsAriaLabel: "Setup checklist",
      dashboardChecklistStepCreatePinTitle: "Create your PIN",
      dashboardChecklistStepAddAssetTitle: "Add your first asset",
      dashboardChecklistStepAddBeneficiaryTitle: "Add your first beneficiary",
      dashboardChecklistStatusDone: "Done",
      dashboardChecklistStatusPending: "Pending",
      dashboardChecklistActionCreatePin: "Create your PIN",
      dashboardChecklistActionCreateAsset: "Add your first asset",
      dashboardChecklistActionCreateBeneficiary: "Add your first beneficiary",
    };

    return messages[key] ?? key;
  },
}));

describe("DashboardOnboardingChecklist", () => {
  it("shows progress and CTA for the next pending step", () => {
    render(
      <DashboardOnboardingChecklist
        hasPin
        totalAssets={0}
        totalBeneficiaries={0}
      />
    );

    expect(screen.getByText("1 of 3 completed")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("Create your PIN")).toBeInTheDocument();
    expect(screen.getByText("Add your first beneficiary")).toBeInTheDocument();
    expect(screen.getAllByText("Add your first asset").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "Add your first asset" })).toHaveAttribute("href", "/wizard");
  });

  it("uses security step as CTA when PIN is missing", () => {
    render(
      <DashboardOnboardingChecklist
        hasPin={false}
        totalAssets={2}
        totalBeneficiaries={0}
      />
    );

    expect(screen.getByRole("link", { name: "Create your PIN" })).toHaveAttribute("href", "/settings/security");
  });

  it("hides CTA when all steps are complete", () => {
    render(
      <DashboardOnboardingChecklist
        hasPin
        totalAssets={1}
        totalBeneficiaries={1}
      />
    );

    expect(screen.getByText("3 of 3 completed")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
