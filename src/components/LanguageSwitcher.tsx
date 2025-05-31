"use client";

import { usePathname, useRouter } from "next/navigation";
import { useParams } from "next/navigation";

export default function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  // Get current locale from params or default to 'en'
  const currentLocale = params?.locale || "en";

  const switchTo = (locale: string) => {
    let newPath = pathname;
    if (currentLocale === "en" && locale === "es") {
      newPath = `/es${pathname}`;
    } else if (currentLocale === "es" && locale === "en") {
      newPath = pathname.replace(/^\/es/, "");
    }
    router.push(newPath);
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        onClick={() => switchTo("en")}
        disabled={currentLocale === "en"}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: currentLocale === "en" ? "2px solid #2563eb" : "1px solid #e5e7eb",
          background: "#fff",
          color: currentLocale === "en" ? "#2563eb" : "#6b7280",
          fontWeight: 600,
          boxShadow: currentLocale === "en" ? "0 2px 8px rgba(37,99,235,0.08)" : undefined,
          transition: "all 0.15s"
        }}
      >
        EN
      </button>
      <button
        onClick={() => switchTo("es")}
        disabled={currentLocale === "es"}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: currentLocale === "es" ? "2px solid #2563eb" : "1px solid #e5e7eb",
          background: "#fff",
          color: currentLocale === "es" ? "#2563eb" : "#6b7280",
          fontWeight: 600,
          boxShadow: currentLocale === "es" ? "0 2px 8px rgba(37,99,235,0.08)" : undefined,
          transition: "all 0.15s"
        }}
      >
        ES
      </button>
    </div>
  );
} 