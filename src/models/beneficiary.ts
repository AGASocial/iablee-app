export interface Beneficiary {
  id: string;
  full_name: string;
  email: string | null;
  relationship: string | null;
  phone_number: string | null;
  notes: string | null;
  notified: boolean | null;
  status: string | null;
  last_notified_at: string | null;
  email_verified: boolean | null;
}