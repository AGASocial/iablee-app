export interface Beneficiary {
    id: string;
    full_name: string;
    email: string | null;
    phone_number: string | null;
    relationship: string | null;
    notes: string | null;
    notified: boolean | null;
    status: string | null;
    last_notified_at: string | null;
    email_verified: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    user_id: string;
}

export interface AssetFile {
    url: string;
    name: string;
    type: string;
    size: number;
}

export interface Asset {
    id: string;
    asset_name: string;
    asset_type: string;
    status: string;
    email?: string;
    password?: string;
    website?: string;
    valid_until?: string | null;
    description?: string;
    files?: AssetFile[] | null;
    beneficiary_id?: string | null;
    beneficiary?: Beneficiary | null;
    number_of_files?: number;
    user_id?: string;
} 