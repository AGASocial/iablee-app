import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    hkdfSync,
    DecipherGCM,
} from 'crypto';
import { Transform } from 'stream';

// --- Constants ---
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = 1; // Current encryption version
const MASTER_KEY_SALT = 'iablee-master-key-v1'; // Context for HKDF

// --- Types ---
export interface EncryptionMetadata {
    version: number;
    iv: string; // hex
    authTag: string; // hex
    ciphertext: string; // base64 (for small keys)
}

// --- Key Management ---

/**
 * Derives a strong 32-byte key from the .env MASTER_KEY using HKDF.
 * This ensures even if the env var is not perfectly random/formatted, we get a good key.
 */
function getMasterKey(): Buffer {
    const envKey = process.env.STORAGE_MASTER_KEY;
    if (!envKey) {
        throw new Error('STORAGE_MASTER_KEY is missing in environment variables');
    }

    // Derive a key using HKDF (HMAC-based Key Derivation Function)
    // We use the env key as the IKM (Input Keying Material)
    const masterKey = hkdfSync(
        'sha256',
        Buffer.from(envKey),
        Buffer.alloc(0), // No salt needed if IKM is strong, but good practice
        MASTER_KEY_SALT,
        32 // Length
    );

    return Buffer.from(masterKey);
}

/**
 * Generates a random 32-byte key for a user (DEK).
 */
export function generateUserKey(): Buffer {
    return randomBytes(32);
}

// --- User Key Encryption (Envelope) ---

/**
 * Encrypts a User Key (DEK) using the Master Key (KEK).
 * Format: Version(1 byte) + IV(12 bytes) + AuthTag(16 bytes) + Ciphertext
 * Returns: Base64 string to store in DB
 */
export function encryptUserKey(userKey: Buffer): string {
    const masterKey = getMasterKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);

    const encrypted = Buffer.concat([cipher.update(userKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack: Version + IV + AuthTag + EncryptedData
    const packed = Buffer.concat([
        Buffer.from([VERSION]),
        iv,
        authTag,
        encrypted,
    ]);

    return packed.toString('base64');
}

/**
 * Decrypts a User Key from the DB using the Master Key.
 */
export function decryptUserKey(packedKeyBase64: string): Buffer {
    const masterKey = getMasterKey();
    const packed = Buffer.from(packedKeyBase64, 'base64');

    // Unpack
    // Byte 0: Version
    // Byte 1-12: IV
    // Byte 13-28: AuthTag
    // Byte 29+: Ciphertext

    if (packed.length < 1 + IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error('Invalid key format: data too short');
    }

    const version = packed[0];
    if (version !== 1) {
        throw new Error(`Unsupported encryption version: ${version}`);
    }

    const iv = packed.subarray(1, 1 + IV_LENGTH);
    const authTag = packed.subarray(
        1 + IV_LENGTH,
        1 + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const encrypted = packed.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// --- File Stream Encryption (Streaming) ---

/**
 * Creates a Transform stream that encrypts data on the fly.
 * Prepends metadata packet to the start of the stream.
 *
 * Output Stream Format:
 * [Version (1)] [IV (12)] [Encrypted Chunks...] [AuthTag (16 at the end)]
 *
 * NOTE: GCM AuthTag is only available AFTER encryption is done.
 * So we append it to the END of the stream.
 */
export function createEncryptionStream(userKey: Buffer): Transform {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, userKey, iv);

    let isFirstChunk = true;

    return new Transform({
        transform(chunk, encoding, callback) {
            if (isFirstChunk) {
                // Prepend Header: Version + IV
                this.push(Buffer.from([VERSION]));
                this.push(iv);
                isFirstChunk = false;
            }
            // Encrypt chunk
            const encryptedChunk = cipher.update(chunk);
            this.push(encryptedChunk);
            callback();
        },
        flush(callback) {
            // Finalize encryption
            this.push(cipher.final());
            // Append AuthTag at the VERY END
            this.push(cipher.getAuthTag());
            callback();
        },
    });
}

/**
 * Creates a Transform stream that decrypts data on the fly.
 * Expects stream format: [Version] [IV] [Encrypted...] [AuthTag]
 *
 * COMPLEXITY: We need to pull the AuthTag from the END of the stream.
 * But we can't know it's the end until we hit it.
 *
 * Standard GCM stream decryption requires the AuthTag *before* calling final().
 *
 * Strategy:
 * We Buffer the last 16 bytes (AuthTagSize) in the stream.
 * - If we receive chunk N, we check if we have enough data to push (N-16).
 * - We always keep a "tail" buffer of 16 bytes.
 * - When stream ends, that tail is the AuthTag.
 */
export function createDecryptionStream(userKey: Buffer): Transform {
    let decipher: DecipherGCM | null = null;
    let headerRead = false;
    let buffer = Buffer.alloc(0); // Internal buffer to manage the tail
    const HEADER_SIZE = 1 + IV_LENGTH; // Version (1) + IV (12)
    const TAG_SIZE = AUTH_TAG_LENGTH; // 16

    return new Transform({
        transform(chunk, encoding, callback) {
            buffer = Buffer.concat([buffer, chunk]);

            // 1. Read Header if not done
            if (!headerRead) {
                if (buffer.length >= HEADER_SIZE) {
                    const version = buffer[0];
                    if (version !== 1) {
                        callback(new Error(`Unsupported version: ${version}`));
                        return;
                    }
                    const iv = buffer.subarray(1, HEADER_SIZE);
                    decipher = createDecipheriv(ALGORITHM, userKey, iv) as DecipherGCM;

                    // Remove header from buffer
                    buffer = buffer.subarray(HEADER_SIZE);
                    headerRead = true;
                } else {
                    // Need more data for header
                    callback();
                    return;
                }
            }

            // 2. Process Body, keeping trailing TAG_SIZE bytes
            // We can decrypt everything EXCEPT the last 16 bytes.
            if (buffer.length > TAG_SIZE) {
                const toDecrypt = buffer.subarray(0, buffer.length - TAG_SIZE);
                const remaining = buffer.subarray(buffer.length - TAG_SIZE);

                if (!decipher) throw new Error('Decipher not initialized');
                const decrypted = decipher.update(toDecrypt);
                this.push(decrypted);

                buffer = remaining; // Keep the potential tag
            }

            callback();
        },
        flush(callback) {
            // Stream finished. 'buffer' SHOULD contain exactly the AuthTag (16 bytes)
            if (buffer.length !== TAG_SIZE) {
                callback(
                    new Error(
                        `Stream ended unexpectedly. Expected ${TAG_SIZE} bytes tag, got ${buffer.length}`
                    )
                );
                return;
            }

            try {
                if (!decipher) throw new Error('Decipher not initialized');
                const authTag = buffer;
                decipher.setAuthTag(authTag);
                const final = decipher.final();
                this.push(final);
                callback();
            } catch {
                callback(new Error('Decryption failed: Integrity check error'));
            }
        },
    });
}
