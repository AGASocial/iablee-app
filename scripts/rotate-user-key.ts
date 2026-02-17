
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
    createCipheriv,
    createDecipheriv,
    hkdfSync,
    randomBytes
} from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MASTER_KEY_ENV = process.env.STORAGE_MASTER_KEY;

const USER_ID = process.argv[2];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MASTER_KEY_ENV || !USER_ID) {
    console.error('Missing args.');
    console.error('Usage: npm run script:rotate-user-key <USER_ID>');
    process.exit(1);
}

// ... Copy-paste utils or use ts-node to run src ...
// For simplicity in this standalone script, we duplicate the core logic.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = 1;
const MASTER_KEY_SALT = 'iablee-master-key-v1';

function deriveMasterKey(): Buffer {
    return Buffer.from(hkdfSync('sha256', Buffer.from(MASTER_KEY_ENV!), Buffer.alloc(0), MASTER_KEY_SALT, 32));
}

function encryptUserKey(userKey: Buffer): string {
    const masterKey = deriveMasterKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(userKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, authTag, encrypted]).toString('base64');
}

function decryptUserKey(packedKeyBase64: string): Buffer {
    const masterKey = deriveMasterKey();
    const packed = Buffer.from(packedKeyBase64, 'base64');
    const version = packed[0];
    if (version !== 1) console.warn('Unknown key version', version);
    const iv = packed.subarray(1, 1 + IV_LENGTH);
    const authTag = packed.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function generateUserKey(): Buffer {
    return randomBytes(32);
}

// Stream Factories
function createDecryptionStream(userKey: Buffer): Transform {
    let decipher: import('crypto').DecipherGCM | null = null;
    let headerRead = false;
    let buffer = Buffer.alloc(0);
    const HEADER_SIZE = 1 + IV_LENGTH;
    const TAG_SIZE = AUTH_TAG_LENGTH;

    return new Transform({
        transform(chunk, encoding, callback) {
            buffer = Buffer.concat([buffer, chunk]);
            if (!headerRead) {
                if (buffer.length >= HEADER_SIZE) {
                    const version = buffer[0];
                    if (version !== 1) throw new Error('Invalid version');
                    const iv = buffer.subarray(1, HEADER_SIZE);
                    decipher = createDecipheriv(ALGORITHM, userKey, iv) as import('crypto').DecipherGCM;
                    buffer = buffer.subarray(HEADER_SIZE);
                    headerRead = true;
                } else {
                    callback(); return;
                }
            }
            if (buffer.length > TAG_SIZE) {
                const toDecrypt = buffer.subarray(0, buffer.length - TAG_SIZE);
                buffer = buffer.subarray(buffer.length - TAG_SIZE);
                if (!decipher) throw new Error('Decipher not initialized');
                this.push(decipher.update(toDecrypt));
            }
            callback();
        },
        flush(callback) {
            if (buffer.length !== TAG_SIZE) return callback(new Error('Tag missing'));
            try {
                if (!decipher) throw new Error('Decipher not initialized');
                decipher.setAuthTag(buffer);
                this.push(decipher.final());
                callback();
            } catch { callback(new Error('Integrity check failed')); }
        }
    });
}

function createEncryptionStream(userKey: Buffer): Transform {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, userKey, iv);
    let first = true;
    return new Transform({
        transform(chunk, _, cb) {
            if (first) {
                this.push(Buffer.from([VERSION]));
                this.push(iv);
                first = false;
            }
            this.push(cipher.update(chunk));
            cb();
        },
        flush(cb) {
            this.push(cipher.final());
            this.push(cipher.getAuthTag());
            cb();
        }
    });
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
});

async function rotateUserKey() {
    console.log(`Rotating User Key for: ${USER_ID}`);

    // 1. Get Old Key
    const { data: user, error } = await supabaseAdmin.from('users').select('encrypted_storage_key').eq('id', USER_ID).single();
    if (error || !user?.encrypted_storage_key) throw new Error('User not found or has no key');

    const oldKey = decryptUserKey(user.encrypted_storage_key);
    const newKey = generateUserKey();

    console.log('Keys generated. Fetching files...');

    // 2. Fetch Files
    // 2. Fetch Files
    // We can skip fetching attachments here because we fetch them via assets later
    // But logically we want to know if there are any.
    // Let's just proceed to getting assets.

    // Simplification: Get assets first
    const { data: assets } = await supabaseAdmin.from('digital_assets').select('id').eq('user_id', USER_ID);
    if (!assets || assets.length === 0) {
        console.log('No assets found. Just updating key.');
        await updateUserKey(newKey);
        return;
    }

    const assetIds = assets.map(a => a.id);
    const { data: allAttachments } = await supabaseAdmin
        .from('asset_attachments')
        .select('*')
        .in('asset_id', assetIds);

    if (!allAttachments || allAttachments.length === 0) {
        console.log('No files found. Just updating key.');
        await updateUserKey(newKey);
        return;
    }

    console.log(`Found ${allAttachments.length} files to re-encrypt.`);

    // 3. Process Files
    for (const file of allAttachments) {
        console.log(`Processing ${file.file_name}...`);

        // Download
        const { data: downloadBlob, error: downError } = await supabaseAdmin.storage
            .from('assets')
            .download(file.file_path);

        if (downError || !downloadBlob) {
            console.error(`Failed to download ${file.file_path}:`, downError);
            continue;
        }

        // Re-encrypt Stream
        // Convert Blob to stream
        const inputStream = Readable.fromWeb(downloadBlob.stream() as unknown as import('stream/web').ReadableStream);
        const decryptStream = createDecryptionStream(oldKey);
        const encryptStream = createEncryptionStream(newKey);

        const chunks: Buffer[] = [];
        const collector = new Transform({
            transform(chunk, _, cb) { chunks.push(chunk); cb(); }
        });

        await pipeline(inputStream, decryptStream, encryptStream, collector);

        const newFileBuffer = Buffer.concat(chunks);

        // Upload (overwrite)
        const { error: upError } = await supabaseAdmin.storage
            .from('assets')
            .upload(file.file_path, newFileBuffer, {
                contentType: file.file_type,
                upsert: true
            });

        if (upError) {
            console.error(`Failed to upload ${file.file_path}:`, upError);
            throw new Error('Aborting rotation to prevent data inconsistency');
        }
    }

    // 4. Update User Key
    await updateUserKey(newKey);
    console.log('User key rotation successful!');
}

async function updateUserKey(newKey: Buffer) {
    const encrypted = encryptUserKey(newKey);
    await supabaseAdmin.from('users').update({ encrypted_storage_key: encrypted }).eq('id', USER_ID);
    console.log('User Key updated in DB.');
}

rotateUserKey().catch(console.error);
