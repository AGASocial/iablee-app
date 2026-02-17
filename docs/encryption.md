# File Encryption Implementation Walkthrough

## Overview
We have implemented a **Hardened Envelope Encryption** system for Supabase Storage.
-   **Files**: Encrypted using AES-256-GCM with per-user keys.
-   **Streaming**: All operations use Node.js streams to prevent memory issues.
-   **Security**: Keys are derived using HKDF, and all files have unique IVs/AuthTags.

## Verification

### 1. Manual Verification (Upload/Download)
1.  **Login** to the application.
2.  **Upload** a file (e.g., via the "Add Asset" wizard).
    -   *Expected*: The file uploads successfully. In the Supabase dashboard, the file size will be slightly larger (+29 bytes for metadata).
3.  **Download** the file (e.g., click the preview/download link).
    -   *Expected*: The file downloads and opens correctly.

### 2. Verify Database Changes
Check the `users` table. You should see a populated `encrypted_storage_key` column for users who have uploaded files.
```sql
SELECT id, encrypted_storage_key FROM users WHERE encrypted_storage_key IS NOT NULL;
```

### 3. Database Hardening (Safe Decrypt)
We implemented a `safe_decrypt` SQL function to prevent the `decrypted_digital_assets` view from crashing if a row contains corrupted or invalid ciphertext.
-   **Function**: `public.safe_decrypt(ciphertext text, key_id uuid)`
-   **Behavior**: Returns `NULL` instead of throwing an error for invalid input.
-   **View**: `decrypted_digital_assets` now uses this function for `password` and `custom_fields`.

## Management Scripts

### Rotate Master Key
Use this if the `.env` `STORAGE_MASTER_KEY` is compromised.
```bash
# Rotation (Requires ts-node or tsx)
export NEW_MASTER_KEY="<new-hex-key>"
npx tsx scripts/rotate-keys.ts
```

### Rotate User Key
Use this if a specific user is compromised. This re-encrypts all their files.
```bash
export USER_ID="<user-uuid>"
npx tsx scripts/rotate-user-key.ts
```

## Environment Variables
Ensure `.env` contains:
```env
STORAGE_MASTER_KEY=07ccbed3c3543e44a8216302696aecde420f35a8c792cb9153645866a5f43ad8
```

## Database Column Encryption (pgsodium)
The database uses `pgsodium` for the `password` and `custom_fields` columns.
-   **Key ID**: Hardcoded in triggers and `decrypted_digital_assets` view.
-   **When to Rotate**:
    1.  **Compromise**: If you suspect an admin account or a database backup has been stolen.
    2.  **Compliance**: If your industry requires key rotation (e.g., every 12 months).
-   **How to Rotate**:
    1.  Create a new key in `pgsodium`.
    2.  Run the rotation function with your Old and New Key IDs:
        ```sql
        SELECT rotate_digital_assets_key('old-uuid', 'new-uuid');
        ```
    This function will automatically:
    -   Disable triggers.
    -   Re-encrypt all data (decrypt with old, encrypt with new).
    -   Update the `decrypted_digital_assets` view to use the new key.
    -   Update the trigger functions to use the new key.
    -   Re-enable triggers.

## Appendix: SQL Functions

### `safe_decrypt`
Prevents view crashes on invalid data.
```sql
CREATE OR REPLACE FUNCTION public.safe_decrypt(ciphertext text, key_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    BEGIN
        RETURN convert_from(
            pgsodium.crypto_aead_det_decrypt(
                decode(ciphertext, 'base64'),
                convert_to('', 'utf8'),
                key_id,
                NULL
            ),
            'utf8'
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
END;
$function$;
```

### `rotate_digital_assets_key`
Automates Key Rotation.
```sql
CREATE OR REPLACE FUNCTION public.rotate_digital_assets_key(old_key_id uuid, new_key_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    r RECORD;
    decrypted_pass text;
    decrypted_custom text;
BEGIN
    -- 1. Disable triggers to prevent auto-encryption during update
    ALTER TABLE digital_assets DISABLE TRIGGER digital_assets_encrypt_secret_trigger_password;
    ALTER TABLE digital_assets DISABLE TRIGGER digital_assets_encrypt_secret_trigger_custom_fields;

    -- 2. Loop through all rows and re-encrypt
    FOR r IN SELECT id, password, custom_fields FROM digital_assets LOOP
        -- Decrypt with OLD key
        IF r.password IS NOT NULL THEN
            decrypted_pass := convert_from(
                pgsodium.crypto_aead_det_decrypt(
                    decode(r.password, 'base64'),
                    convert_to('', 'utf8'),
                    old_key_id,
                    NULL
                ),
                'utf8'
            );
            
            -- Encrypt with NEW key
            UPDATE digital_assets 
            SET password = encode(
                pgsodium.crypto_aead_det_encrypt(
                    convert_to(decrypted_pass, 'utf8'),
                    convert_to('', 'utf8'),
                    new_key_id,
                    NULL
                ),
                'base64'
            )
            WHERE id = r.id;
        END IF;

        IF r.custom_fields IS NOT NULL THEN
             decrypted_custom := convert_from(
                pgsodium.crypto_aead_det_decrypt(
                    decode(r.custom_fields, 'base64'),
                    convert_to('', 'utf8'),
                    old_key_id,
                    NULL
                ),
                'utf8'
            );
            
            -- Encrypt with NEW key
             UPDATE digital_assets 
            SET custom_fields = encode(
                pgsodium.crypto_aead_det_encrypt(
                    convert_to(decrypted_custom, 'utf8'),
                    convert_to('', 'utf8'),
                    new_key_id,
                    NULL
                ),
                'base64'
            )
            WHERE id = r.id;
        END IF;
    END LOOP;

    -- 3. Update the VIEW definition to use the New Key
    EXECUTE format('
        CREATE OR REPLACE VIEW public.decrypted_digital_assets AS
        SELECT digital_assets.id,
            digital_assets.user_id,
            digital_assets.asset_type,
            digital_assets.asset_name,
            digital_assets.beneficiary_id,
            digital_assets.status,
            digital_assets.email,
            digital_assets.password,
            public.safe_decrypt(digital_assets.password, %L::uuid) AS decrypted_password,
            digital_assets.website,
            digital_assets.valid_until,
            digital_assets.description,
            digital_assets.files,
            digital_assets.created_at,
            digital_assets.updated_at,
            digital_assets.number_of_files,
            digital_assets.custom_fields,
            public.safe_decrypt(digital_assets.custom_fields, %L::uuid) AS decrypted_custom_fields
        FROM digital_assets;', new_key_id, new_key_id);

    -- 4. Re-create Triggers with New Key (Using dynamic SQL to inject the ID)
    
    EXECUTE format('
        CREATE OR REPLACE FUNCTION public.digital_assets_encrypt_secret_password()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $tf$
        BEGIN
                new.password = CASE WHEN new.password IS NULL THEN NULL ELSE
                    CASE WHEN %L IS NULL THEN NULL ELSE pg_catalog.encode(
                      pgsodium.crypto_aead_det_encrypt(
                        pg_catalog.convert_to(new.password, ''utf8''),
                        pg_catalog.convert_to(''''''::text, ''utf8''),
                        %L::uuid,
                        NULL
                      ),
                        ''base64'') END END;
                RETURN new;
        END;
        $tf$', new_key_id, new_key_id);

    EXECUTE format('
        CREATE OR REPLACE FUNCTION public.digital_assets_encrypt_secret_custom_fields()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $tf$
        BEGIN
                new.custom_fields = CASE WHEN new.custom_fields IS NULL THEN NULL ELSE
                    CASE WHEN %L IS NULL THEN NULL ELSE pg_catalog.encode(
                      pgsodium.crypto_aead_det_encrypt(
                        pg_catalog.convert_to(new.custom_fields, ''utf8''),
                        pg_catalog.convert_to(''''''::text, ''utf8''),
                        %L::uuid,
                        NULL
                      ),
                        ''base64'') END END;
                RETURN new;
        END;
        $tf$', new_key_id, new_key_id);

    -- 5. Re-enable triggers
    ALTER TABLE digital_assets ENABLE TRIGGER digital_assets_encrypt_secret_trigger_password;
    ALTER TABLE digital_assets ENABLE TRIGGER digital_assets_encrypt_secret_trigger_custom_fields;

END;
$function$;
```
