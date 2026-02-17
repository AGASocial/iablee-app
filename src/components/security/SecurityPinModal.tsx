"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PinInput } from "@/components/ui/pin-input";
import { Loader2, Lock, ShieldCheck, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

interface SecurityPinModalProps {
    isOpen: boolean;
    mode: "setup" | "verify" | "change"; // setup: create new pin, verify: enter existing pin, change: modify existing
    onSuccess: () => void;
    onCancel: () => void;
    forceOpen?: boolean; // If true, cannot close without success
}

export default function SecurityPinModal({ isOpen, mode, onSuccess, onCancel, forceOpen = false }: SecurityPinModalProps) {
    const t = useTranslations();
    const [pin, setPin] = useState("");
    const [step, setStep] = useState<"enter" | "create" | "confirm">(mode === "setup" ? "create" : "enter");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showForgotLink, setShowForgotLink] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setPin("");
            setError(null);
            setShowForgotLink(false);
            setStep(mode === "setup" ? "create" : "enter");
        }
    }, [isOpen, mode]);

    const handlePinComplete = async (enteredPin: string) => {
        setError(null);
        setPin(enteredPin);
        setShowForgotLink(false);

        if (step === "enter") {
            await verifyPin(enteredPin);
        } else if (step === "create") {
            setStep("confirm");
            setPin(enteredPin); // Store first entry
        } else if (step === "confirm") {
            if (enteredPin !== pin) {
                setError(t("pinMismatch") !== "pinMismatch" ? t("pinMismatch") : "PINs do not match. Try again.");
                setStep("create");
                setPin("");
            } else {
                await setPinApi(enteredPin);
            }
        }
    };

    const verifyPin = async (enteredPin: string) => {
        setLoading(true);
        try {
            const res = await fetch("/api/security/verify-pin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin: enteredPin }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Verification failed");
            }

            onSuccess();
        } catch (err: unknown) {
            const error = err as Error;
            setError(error.message || "Invalid PIN");
            setPin(""); // clear pin to allow retry
            setShowForgotLink(true);
        } finally {
            setLoading(false);
        }
    };

    const setPinApi = async (newPin: string) => {
        setLoading(true);
        try {
            const res = await fetch("/api/security/set-pin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin: newPin }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to set PIN");
            }

            onSuccess();
        } catch (err: unknown) {
            const error = err as Error;
            setError(error.message || "Error setting PIN");
            setStep("create");
            setPin("");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open && !forceOpen) {
            onCancel();
        }
    };

    const getTitle = () => {
        if (step === "enter") return t("enterSecurityPin") !== "enterSecurityPin" ? t("enterSecurityPin") : "Enter Security PIN";
        if (step === "create") return t("createSecurityPin") !== "createSecurityPin" ? t("createSecurityPin") : "Create Security PIN";
        if (step === "confirm") return t("confirmSecurityPin") !== "confirmSecurityPin" ? t("confirmSecurityPin") : "Confirm Security PIN";
        return "Security PIN";
    };

    const getDescription = () => {
        if (step === "enter") return t("enterPinDescription") !== "enterPinDescription" ? t("enterPinDescription") : "Please enter your 6-digit PIN to access this section.";
        if (step === "create") return t("createPinDescription") !== "createPinDescription" ? t("createPinDescription") : "Set a 6-digit PIN to secure your assets and beneficiaries.";
        if (step === "confirm") return t("confirmPinDescription") !== "confirmPinDescription" ? t("confirmPinDescription") : "Re-enter your PIN to confirm.";
        return "";
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md flex flex-col justify-center" onPointerDownOutside={(e) => forceOpen && e.preventDefault()} onEscapeKeyDown={(e) => forceOpen && e.preventDefault()}>
                <DialogHeader>
                    <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
                        {step === "enter" ? <Lock className="w-6 h-6 text-primary" /> : <ShieldCheck className="w-6 h-6 text-primary" />}
                    </div>
                    <DialogTitle className="text-center text-xl">{getTitle()}</DialogTitle>
                    <DialogDescription className="text-center">
                        {getDescription()}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center py-6 space-y-6">
                    {!loading ? (
                        <PinInput
                            key={step} // Reset input on step change
                            length={6}
                            onComplete={handlePinComplete}
                            disabled={loading}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                    )}

                    {error && (
                        <div className="flex flex-col items-center space-y-2">
                            <div className="flex items-center text-destructive text-sm bg-destructive/10 p-2 rounded-md transition-all animate-in fade-in slide-in-from-top-1">
                                <AlertCircle className="w-4 h-4 mr-2" />
                                {error}
                            </div>
                            {showForgotLink && step === "enter" && (
                                <Link href="/settings/security" className="text-sm text-primary hover:underline mt-2">
                                    {t("forgotPin") || "Forgot your PIN?"}
                                </Link>
                            )}
                        </div>
                    )}
                </div>

                {!forceOpen && (
                    <div className="flex justify-center">
                        <Button variant="ghost" onClick={onCancel} disabled={loading}>
                            {t("cancel")}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
