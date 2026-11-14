import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 100;

export const PASSWORD_RULE_IDS = [
  "minLength",
  "maxLength",
  "lowercase",
  "uppercase",
  "number",
  "special",
  "noSequence",
  "noRepeat",
  "notEmail",
] as const;

export type PasswordRuleId = (typeof PASSWORD_RULE_IDS)[number];

export type PasswordPolicyOptions = {
  email?: string | null;
  /** When false, skip the email local-part rule even if email is provided. Default true. */
  checkEmail?: boolean;
};

export type PasswordValidationResult = {
  ok: boolean;
  failed: PasswordRuleId[];
  passed: PasswordRuleId[];
};

const ENGLISH_MESSAGES: Record<PasswordRuleId, string> = {
  minLength: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  maxLength: `Password must be less than ${PASSWORD_MAX_LENGTH} characters`,
  lowercase: "Password must include at least one lowercase letter",
  uppercase: "Password must include at least one uppercase letter",
  number: "Password must include at least one number",
  special: "Password must include at least one special character",
  noSequence:
    "Password must not contain 4 or more sequential characters (e.g. 1234, abcd, 4321)",
  noRepeat: "Password must not contain 4 or more repeated characters (e.g. 1111)",
  notEmail: "Password must not contain your email address",
};

function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at).trim();
  return local.length >= 3 ? local : null;
}

function isSequentialRun(chars: string): boolean {
  if (chars.length < 4) return false;

  const allDigits = /^[0-9]+$/.test(chars);
  const allLetters = /^[a-zA-Z]+$/.test(chars);
  if (!allDigits && !allLetters) return false;

  const values = allDigits
    ? [...chars].map((c) => c.charCodeAt(0) - 48)
    : [...chars.toLowerCase()].map((c) => c.charCodeAt(0) - 97);

  let ascending = true;
  let descending = true;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== values[i - 1]! + 1) ascending = false;
    if (values[i] !== values[i - 1]! - 1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}

function hasForbiddenSequence(password: string): boolean {
  for (let i = 0; i <= password.length - 4; i += 1) {
    if (isSequentialRun(password.slice(i, i + 4))) return true;
  }
  return false;
}

function hasForbiddenRepeat(password: string): boolean {
  return /(.)\1{3,}/.test(password);
}

/**
 * Evaluate account password strength rules.
 * Does not apply to third-party / asset credential fields.
 */
export function validatePassword(
  password: string,
  options: PasswordPolicyOptions = {},
): PasswordValidationResult {
  const failed: PasswordRuleId[] = [];
  const checkEmail = options.checkEmail !== false;
  const local = checkEmail ? emailLocalPart(options.email) : null;

  const rules: Array<{ id: PasswordRuleId; ok: boolean; include: boolean }> = [
    { id: "minLength", ok: password.length >= PASSWORD_MIN_LENGTH, include: true },
    { id: "maxLength", ok: password.length <= PASSWORD_MAX_LENGTH, include: true },
    { id: "lowercase", ok: /[a-z]/.test(password), include: true },
    { id: "uppercase", ok: /[A-Z]/.test(password), include: true },
    { id: "number", ok: /[0-9]/.test(password), include: true },
    { id: "special", ok: /[^A-Za-z0-9]/.test(password), include: true },
    { id: "noSequence", ok: !hasForbiddenSequence(password), include: true },
    { id: "noRepeat", ok: !hasForbiddenRepeat(password), include: true },
    {
      id: "notEmail",
      ok: !local || !password.toLowerCase().includes(local.toLowerCase()),
      include: Boolean(local),
    },
  ];

  const passed: PasswordRuleId[] = [];
  for (const rule of rules) {
    if (!rule.include) continue;
    if (rule.ok) passed.push(rule.id);
    else failed.push(rule.id);
  }

  return { ok: failed.length === 0, failed, passed };
}

export function isPasswordValid(
  password: string,
  options: PasswordPolicyOptions = {},
): boolean {
  return validatePassword(password, options).ok;
}

export function getPasswordPolicyMessage(
  result: PasswordValidationResult,
  ruleId?: PasswordRuleId,
): string {
  const id = ruleId ?? result.failed[0];
  if (!id) return "Password does not meet requirements";
  return ENGLISH_MESSAGES[id] ?? "Password does not meet requirements";
}

/** English error string suitable for API 400 responses. */
export function getPasswordPolicyError(
  password: string,
  options: PasswordPolicyOptions = {},
): string | null {
  const result = validatePassword(password, options);
  if (result.ok) return null;
  return getPasswordPolicyMessage(result);
}

/** Checklist rule ids shown in the live UI (excludes maxLength). */
export const PASSWORD_CHECKLIST_RULES: PasswordRuleId[] = [
  "minLength",
  "uppercase",
  "lowercase",
  "number",
  "special",
  "noSequence",
  "noRepeat",
  "notEmail",
];

export function getChecklistRuleStatus(
  password: string,
  options: PasswordPolicyOptions = {},
): Array<{ id: PasswordRuleId; met: boolean; visible: boolean }> {
  const result = validatePassword(password, options);
  const checkEmail = options.checkEmail !== false;
  const local = checkEmail ? emailLocalPart(options.email) : null;
  const failed = new Set(result.failed);

  return PASSWORD_CHECKLIST_RULES.map((id) => {
    if (id === "notEmail") {
      if (!local) return { id, met: false, visible: false };
      return { id, met: !failed.has("notEmail"), visible: true };
    }
    // Empty field: show all rules as unmet so the checklist starts clear.
    if (password.length === 0) {
      return { id, met: false, visible: true };
    }
    return { id, met: !failed.has(id), visible: true };
  });
}

/** Zod helper: refine a string password field. */
export function refinePassword(
  password: string,
  ctx: z.RefinementCtx,
  options: PasswordPolicyOptions & { path?: (string | number)[]; message?: string } = {},
): void {
  const result = validatePassword(password, options);
  if (result.ok) return;
  ctx.addIssue({
    code: "custom",
    message: options.message ?? getPasswordPolicyMessage(result),
    path: options.path ?? [],
  });
}

/** Reusable zod checker for object schemas with a `password` field. */
export function strongPasswordSuperRefine(
  options: PasswordPolicyOptions & {
    passwordKey?: string;
    emailKey?: string;
    message?: string;
  } = {},
) {
  const passwordKey = options.passwordKey ?? "password";
  const emailKey = options.emailKey;

  return (data: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const password = data[passwordKey];
    if (typeof password !== "string") return;

    const emailFromData =
      emailKey && typeof data[emailKey] === "string"
        ? (data[emailKey] as string)
        : options.email;

    refinePassword(password, ctx, {
      email: emailFromData,
      checkEmail: options.checkEmail,
      message: options.message,
      path: [passwordKey],
    });
  };
}
