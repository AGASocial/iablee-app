import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BeneficiaryFormData, FieldErrors } from "./types";

interface Relationship {
  id: number;
  key: string;
}

interface BeneficiaryStepProps {
  data: BeneficiaryFormData;
  errors: FieldErrors;
  relationships: Relationship[];
  saving: boolean;
  onChange: <K extends keyof BeneficiaryFormData>(field: K, value: BeneficiaryFormData[K]) => void;
  onBack: () => void;
  onSave: () => void;
  onValidateBlur?: () => void;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function BeneficiaryStep({
  data,
  errors,
  relationships,
  saving,
  onChange,
  onBack,
  onSave,
  onValidateBlur,
  translate,
}: BeneficiaryStepProps) {
  return (
    <section className="space-y-5" onBlurCapture={onValidateBlur}>
      <div>
        <h2 className="font-heading text-2xl text-foreground">{translate("wizard-step-beneficiary-title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{translate("wizard-step-beneficiary-description")}</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="beneficiary-name" className="text-sm text-foreground">
            {translate("name")} *
          </Label>
          <Input
            id="beneficiary-name"
            value={data.fullName}
            onChange={(event) => onChange("fullName", event.target.value)}
            placeholder={translate("wizard-enter-beneficiary-name")}
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? "beneficiary-name-error" : undefined}
          />
          {errors.fullName ? (
            <p id="beneficiary-name-error" className="mt-1 text-sm text-destructive">
              {translate(errors.fullName)}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="beneficiary-email" className="text-sm text-foreground">
            {translate("email")}
          </Label>
          <Input
            id="beneficiary-email"
            value={data.email}
            onChange={(event) => onChange("email", event.target.value)}
            type="email"
            placeholder={translate("wizard-email-placeholder")}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "beneficiary-email-error" : undefined}
          />
          {errors.email ? (
            <p id="beneficiary-email-error" className="mt-1 text-sm text-destructive">
              {translate(errors.email)}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="beneficiary-relationship" className="text-sm text-foreground">
            {translate("relationship")} *
          </Label>
          <Select
            value={data.relationshipId ? data.relationshipId.toString() : undefined}
            onValueChange={(value) => onChange("relationshipId", Number(value))}
          >
            <SelectTrigger
              id="beneficiary-relationship"
              aria-invalid={Boolean(errors.relationshipId)}
              aria-describedby={errors.relationshipId ? "beneficiary-relationship-error" : undefined}
            >
              <SelectValue placeholder={translate("wizard-select-relationship")} />
            </SelectTrigger>
            <SelectContent>
              {relationships.map((rel) => (
                <SelectItem key={rel.id} value={rel.id.toString()}>
                  {translate(`relationships.${rel.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.relationshipId ? (
            <p id="beneficiary-relationship-error" className="mt-1 text-sm text-destructive">
              {translate(errors.relationshipId)}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="beneficiary-phone" className="text-sm text-foreground">
            {translate("phoneNumber")}
          </Label>
          <Input
            id="beneficiary-phone"
            value={data.phoneNumber}
            onChange={(event) => onChange("phoneNumber", event.target.value)}
            placeholder={translate("wizard-phone-placeholder")}
          />
        </div>

        <div>
          <Label htmlFor="beneficiary-notes" className="text-sm text-foreground">
            {translate("notes")}
          </Label>
          <Textarea
            id="beneficiary-notes"
            value={data.notes}
            onChange={(event) => onChange("notes", event.target.value)}
            placeholder={translate("wizard-enter-beneficiary-notes")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onBack}>
          {translate("back")}
        </Button>
        <Button type="button" className="h-11 flex-1" onClick={onSave} disabled={saving}>
          {saving ? translate("saving") : translate("wizard-save")}
        </Button>
      </div>
    </section>
  );
}
