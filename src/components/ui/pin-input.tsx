"use client";

import React, { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface PinInputProps {
    length?: number;
    onComplete: (pin: string) => void;
    disabled?: boolean;
}

export function PinInput({ length = 6, onComplete, disabled = false }: PinInputProps) {
    const [pin, setPin] = useState<string[]>(new Array(length).fill(""));
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // If an external valid pin is provided via some prop we could use it, 
    // but here we just want to expose a way to reset.
    // However, the standard way in React is to be a controlled component or exposed ref.
    // Given the implementation in SecuritySettingsPage uses reset by key or just remounting, 
    // actually, let's just make sure we export a way to clear or use a key.
    // But wait, the user's implementation in `SecuritySettingsPage` calls `setCurrentPin` etc.
    // The `PinInput` component does NOT take a `value` prop currently, so it is uncontrolled internally.
    // If I want to clear it, I should add a key prop in the parent or make it controlled.
    // Making it fully controlled is better.


    useEffect(() => {
        if (inputRefs.current[0] && !disabled) {
            inputRefs.current[0].focus();
        }
    }, [disabled]);

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;

        const newPin = [...pin];
        // Allow pasting
        if (value.length > 1) {
            const pastedData = value.slice(0, length).split("");
            for (let i = 0; i < length; i++) {
                newPin[i] = pastedData[i] || "";
            }
            setPin(newPin);
            if (newPin.every((digit) => digit !== "") && newPin.join("").length === length) {
                onComplete(newPin.join(""));
                inputRefs.current[length - 1]?.focus();
            } else {
                const nextIndex = Math.min(pastedData.length, length - 1);
                inputRefs.current[nextIndex]?.focus();
            }
            return;
        }

        newPin[index] = value;
        setPin(newPin);

        // Auto-focus next input
        if (value !== "" && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }

        // Trigger onComplete if full
        if (newPin.every((digit) => digit !== "") && newPin.join("").length === length) {
            onComplete(newPin.join(""));
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace") {
            if (pin[index] === "" && index > 0) {
                inputRefs.current[index - 1]?.focus();
                const newPin = [...pin];
                newPin[index - 1] = "";
                setPin(newPin);
            } else {
                const newPin = [...pin];
                newPin[index] = "";
                setPin(newPin);
            }
        } else if (e.key === "ArrowLeft" && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === "ArrowRight" && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        e.target.select();
    };

    return (
        <div className="flex gap-2 justify-center">
            {pin.map((digit, index) => (
                <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el; }} // Correctly assign to mutable ref array
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={length} // Allow pasting but limit typing to 1 char effectively via logic, maxLength for paste helps
                    value={digit}
                    disabled={disabled}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onFocus={handleFocus}
                    className={cn(
                        "w-10 h-12 text-center text-xl font-bold rounded-md border border-input bg-transparent shadow-sm transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                        digit ? "border-primary" : "border-input"
                    )}
                />
            ))}
        </div>
    );
}
