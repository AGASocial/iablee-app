import {
  getPasswordPolicyError,
  isPasswordValid,
  validatePassword,
} from "../password-policy";

describe("password-policy", () => {
  const valid = "Password123!";

  it("accepts a valid password", () => {
    const result = validatePassword(valid);
    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([]);
    expect(isPasswordValid(valid)).toBe(true);
    expect(getPasswordPolicyError(valid)).toBeNull();
  });

  it("accepts Password123! (12 chars, all classes, 123 is only 3 digits)", () => {
    expect(isPasswordValid("Password123!")).toBe(true);
  });

  it("rejects too short passwords", () => {
    const result = validatePassword("Ab1!xxxx");
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("minLength");
  });

  it("rejects passwords over max length", () => {
    const result = validatePassword(`${"Aa1!".repeat(26)}x`); // 105 chars
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("maxLength");
  });

  it("rejects missing lowercase", () => {
    expect(validatePassword("PASSWORD123!").failed).toContain("lowercase");
  });

  it("rejects missing uppercase", () => {
    expect(validatePassword("password123!").failed).toContain("uppercase");
  });

  it("rejects missing number", () => {
    expect(validatePassword("Password!!!!").failed).toContain("number");
  });

  it("rejects missing special character", () => {
    expect(validatePassword("Password1234").failed).toContain("special");
  });

  it("rejects ascending sequential digits of length 4+", () => {
    expect(validatePassword("Pass1234!ab").failed).toContain("noSequence");
    expect(validatePassword("Pass2345!ab").failed).toContain("noSequence");
  });

  it("rejects descending sequential digits of length 4+", () => {
    expect(validatePassword("Pass4321!ab").failed).toContain("noSequence");
    expect(validatePassword("Pass9876!ab").failed).toContain("noSequence");
  });

  it("rejects ascending sequential letters case-insensitively", () => {
    expect(validatePassword("XXabcd12!Y").failed).toContain("noSequence");
    expect(validatePassword("XXABCD12!Y").failed).toContain("noSequence");
  });

  it("rejects descending sequential letters", () => {
    expect(validatePassword("XXdcba12!Y").failed).toContain("noSequence");
  });

  it("allows 3-long sequences", () => {
    expect(isPasswordValid("Password123!")).toBe(true);
    expect(isPasswordValid("Passw0rdabc!")).toBe(true);
  });

  it("does not treat wrap-around as a sequence", () => {
    expect(isPasswordValid("Passw0rdyzab!")).toBe(true);
  });

  it("rejects 4 repeated characters", () => {
    expect(validatePassword("Pass1111!ab").failed).toContain("noRepeat");
    expect(validatePassword("Passaaaa!12").failed).toContain("noRepeat");
  });

  it("allows 3 repeated characters", () => {
    expect(isPasswordValid("Pass111!xyz")).toBe(true);
    expect(isPasswordValid("Passaaa!123")).toBe(true);
  });

  it("rejects email local-part when length >= 3", () => {
    const result = validatePassword("JohnDoe123!", { email: "johndoe@example.com" });
    expect(result.failed).toContain("notEmail");
  });

  it("ignores tiny email local-parts (< 3 chars)", () => {
    expect(isPasswordValid("Ab12!xyZqw", { email: "ab@example.com" })).toBe(true);
  });

  it("skips email rule when checkEmail is false", () => {
    expect(
      isPasswordValid("JohnDoe123!", { email: "johndoe@example.com", checkEmail: false }),
    ).toBe(true);
  });

  it("returns a clear English error string", () => {
    const error = getPasswordPolicyError("short");
    expect(error).toMatch(/at least 10/i);
  });
});
