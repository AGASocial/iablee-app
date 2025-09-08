import { Beneficiary } from "./beneficiary";

export interface Asset {
  id: string;
  user_id: string;
  asset_type: string;
  asset_name: string;
  beneficiary?: Beneficiary;
  beneficiary_id?: string;
  status: 'active' | 'inactive' | 'pending' | 'assigned';
  email?: string;
  password?: string;
  website?: string;
  valid_until?: string;
  number_of_files?: number;
  description?: string;
  files?: string[];
  custom_fields?: Record<string, string | number | boolean | string[]>;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetData {
  user_id: string;
  asset_type: string;
  asset_name: string;
  beneficiary_id?: string;
  status?: 'active' | 'inactive' | 'pending' | 'assigned';
  email?: string;
  password?: string;
  website?: string;
  valid_until?: string;
  description?: string;
  files?: string[];
  custom_fields?: Record<string, string | number | boolean | string[]>;
}

export interface UpdateAssetData {
  asset_type?: string;
  asset_name?: string;
  beneficiary_id?: string;
  status?: 'active' | 'inactive' | 'pending' | 'assigned';
  email?: string;
  password?: string;
  website?: string;
  valid_until?: string;
  description?: string;
  files?: string[];
  custom_fields?: Record<string, string | number | boolean | string[]>;
}