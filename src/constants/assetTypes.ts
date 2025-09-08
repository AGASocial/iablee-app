import {
    Mail,
    Mic,
    Camera,
    Video,
    File,
    LucideIcon
} from "lucide-react";

export interface AssetType {
    key: string;
    label: string;
    icon: LucideIcon;
    description?: string;
    requiredFields?: string[];
    optionalFields?: string[];
    fileAccept?: string;
    customFields?: {
        key: string;
        label: string;
        type: 'text' | 'textarea' | 'file' | 'select';
        required?: boolean;
        options?: string[];
    }[];
}

export const ASSET_TYPES: AssetType[] = [
    {
        key: "cartas",
        label: "Cartas",
        icon: Mail,
        description: "Cartas y mensajes personales",
        requiredFields: ["asset_name"],
        optionalFields: ["description"],
        fileAccept: "*",
        customFields: [
            {
                key: "message_content",
                label: "writeWhatYouWantToSay",
                type: "textarea",
                required: true
            }
        ]
    },
    {
        key: "audios",
        label: "Audios",
        icon: Mic,
        description: "Grabaciones de audio y mensajes de voz",
        requiredFields: ["asset_name"],
        optionalFields: [],
        fileAccept: "audio/*",
        customFields: [
            {
                key: "audio_note",
                label: "recordHereOrUpload",
                type: "file",
                required: true
            }
        ]
    },
    {
        key: "fotos",
        label: "Fotos",
        icon: Camera,
        description: "Fotografías y imágenes",
        requiredFields: ["asset_name"],
        optionalFields: [],
        fileAccept: "image/*",
        customFields: [
            {
                key: "photo_caption",
                label: "photoCaption",
                type: "text",
                required: false
            }
        ]
    },
    {
        key: "videos",
        label: "Videos",
        icon: Video,
        description: "Videos y grabaciones",
        requiredFields: ["asset_name"],
        optionalFields: [],
        fileAccept: "video/*",
        customFields: [
            {
                key: "video_caption",
                label: "videoCaption",
                type: "text",
                required: false
            }
        ]
    },
    {
        key: "documentos",
        label: "Documentos",
        icon: File,
        description: "Documentos y archivos importantes",
        requiredFields: ["asset_name"],
        optionalFields: ["description"],
        fileAccept: "*",
        customFields: [
            {
                key: "document_type",
                label: "documentType",
                type: "select",
                required: true,
                options: ["identification", "passport", "certificate", "contract", "invoice", "receipt", "other"]
            },
            {
                key: "observations",
                label: "observations",
                type: "textarea",
                required: false
            }
        ]
    },
    //   {
    //     key: "bank",
    //     label: "bankAccount",
    //     icon: Banknote,
    //     description: "Bank accounts and financial accounts",
    //     requiredFields: ["asset_name", "email"],
    //     optionalFields: ["password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "life",
    //     label: "lifeInsurance",
    //     icon: Shield,
    //     description: "Life insurance policies",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "insurance",
    //     label: "insurance",
    //     icon: Shield,
    //     description: "General insurance policies",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "retirement",
    //     label: "retirementPlan",
    //     icon: FileText,
    //     description: "Retirement and pension plans",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "realestate",
    //     label: "realEstate",
    //     icon: Home,
    //     description: "Real estate properties",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "stocks",
    //     label: "companyStocks",
    //     icon: BarChart,
    //     description: "Company stocks and equity",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "rsus",
    //     label: "rsus",
    //     icon: Award,
    //     description: "Restricted Stock Units",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "stockoptions",
    //     label: "stockOptions",
    //     icon: LineChart,
    //     description: "Stock options and derivatives",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "shares",
    //     label: "companyShares",
    //     icon: PieChart,
    //     description: "Company shares and ownership",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "crypto",
    //     label: "cryptocurrency",
    //     icon: Bitcoin,
    //     description: "Cryptocurrency wallets and holdings",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "safety",
    //     label: "safetyBox",
    //     icon: Vault,
    //     description: "Safety deposit boxes and secure storage",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   },
    //   {
    //     key: "other",
    //     label: "other",
    //     icon: MoreHorizontal,
    //     description: "Other digital assets",
    //     requiredFields: ["asset_name"],
    //     optionalFields: ["email", "password", "website", "valid_until", "description"]
    //   }
];

// Helper function to get asset type by key
export const getAssetType = (key: string): AssetType | undefined => {
    return ASSET_TYPES.find(type => type.key === key);
};

// Helper function to get all asset type keys
export const getAssetTypeKeys = (): string[] => {
    return ASSET_TYPES.map(type => type.key);
};

// Helper function to get asset type labels
export const getAssetTypeLabels = (): string[] => {
    return ASSET_TYPES.map(type => type.label);
};

// JSON export for external systems (without icons)
export const ASSET_TYPES_JSON = ASSET_TYPES.map(type => ({
    key: type.key,
    label: type.label,
    description: type.description,
    requiredFields: type.requiredFields,
    optionalFields: type.optionalFields
}));
