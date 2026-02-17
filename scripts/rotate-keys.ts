
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
    createCipheriv,
    createDecipheriv,
    hkdfSync,
    randomBytes
} from 'crypto';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLD_MASTER_KEY_ENV = process.env.STORAGE_MASTER_KEY;

// NEW KEY PASSED AS ARGUMENT OR ENV
const NEW_MASTER_KEY_ENV = process.env.NEW_MASTER_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OLD_MASTER_KEY_ENV || !NEW_MASTER_KEY_ENV) {
    console.error('Missing required environment variables.');
    console.error('Usage: NEW_MASTER_KEY=... npm run script:rotate-keys');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// --- Encryption Utils (Duplicate to avoid importing from src/lib which might have complex deps) ---
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = 1;
const MASTER_KEY_SALT = 'iablee-master-key-v1';

function deriveKey(envKey: string): Buffer {
    return Buffer.from(hkdfSync('sha256', Buffer.from(envKey), Buffer.alloc(0), MASTER_KEY_SALT, 32));
}

function decryptUserKey(packedKeyBase64: string, masterKey: Buffer): Buffer {
    const packed = Buffer.from(packedKeyBase64, 'base64');
    if (packed.length < 1 + IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('Invalid key format');

    const version = packed[0];
    if (version !== 1) throw new Error(`Unsupported version: ${version}`);

    const iv = packed.subarray(1, 1 + IV_LENGTH);
    const authTag = packed.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function encryptUserKey(userKey: Buffer, masterKey: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(userKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([Buffer.from([VERSION]), iv, authTag, encrypted]);
    return packed.toString('base64');
}

async function rotateKeys() {
    console.log('Starting Master Key Rotation...');
    const oldMasterKey = deriveKey(OLD_MASTER_KEY_ENV!);
    const newMasterKey = deriveKey(NEW_MASTER_KEY_ENV!);

    const lastId = null;
    let count = 0;
    let errorCount = 0;

    // Fetch all users with keys
    while (true) {
        let query = supabase
            .from('users')
            .select('id, encrypted_storage_key')
            .not('encrypted_storage_key', 'is', null)
            .order('id', { ascending: true })
            .limit(100);

        if (lastId) {
            query = query.gt('id', lastId); // Wait, UUID sort might be weird. 
            // Better to use range or just iterate if not too many. 
            // For safety with UUIDs, let's use range pagination on page index if order is consistent,
            // or just simple fetching.
        }

        // Supabase range pagination
        const { data: users, error } = await supabase
            .from('users')
            .select('id, encrypted_storage_key')
            .not('encrypted_storage_key', 'is', null)
            .range(count, count + 99);

        if (error) {
            console.error('Error fetching users:', error);
            break;
        }

        if (!users || users.length === 0) break;

        console.log(`Processing batch of ${users.length} users...`);

        for (const user of users) {
            try {
                // Decrypt with OLD
                const userKey = decryptUserKey(user.encrypted_storage_key, oldMasterKey);

                // Encrypt with NEW
                const newEncryptedKey = encryptUserKey(userKey, newMasterKey);

                // Update DB
                const { error: updateError } = await supabase
                    .from('users')
                    .update({ encrypted_storage_key: newEncryptedKey })
                    .eq('id', user.id);

                if (updateError) {
                    console.error(`Failed to update user ${user.id}:`, updateError);
                    errorCount++;
                }
            } catch (e) {
                console.error(`Failed to re-encrypt key for user ${user.id}:`, e);
                errorCount++;
            }
        }

        count += users.length;
        // Simple pagination for now - assuming no new users inserted during script run
        // If IDs are stable, range is okay.
    }

    console.log(`Rotation complete.`);
    console.log(`Processed: ${count}`);
    console.log(`Errors: ${errorCount}`);

    if (errorCount === 0) {
        console.log('\nSUCCESS! You can now update .env with the NEW_MASTER_KEY.');
    } else {
        console.warn('\nWARNING: Some keys failed to rotate. check logs.');
    }
}

rotateKeys().catch(console.error);
