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
        style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", background: currentLocale === "en" ? "#eee" : "#fff" }}
      >
        EN
      </button>
      <button
        onClick={() => switchTo("es")}
        disabled={currentLocale === "es"}
        style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", background: currentLocale === "es" ? "#eee" : "#fff" }}
      >
        ES
      </button>
    </div>
  );
} 