"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { format } from "date-fns"
import { es, enUS } from "date-fns/locale"
import { ShieldCheck, Calendar, User, Heart } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useSecurity } from "@/context/SecurityContext"

interface BeneficiaryRelationship {
  holder_full_name: string
  relationship_key: string | null
  beneficiary_id: string
  email_verified_at: string | null
  created_at: string
}

export default function MyBeneficiaryRelationshipsPage() {
  const t = useTranslations()
  const locale = useLocale()
  const { locked, loading: securityLoading, checkStatus } = useSecurity()
  const unlocked = !securityLoading && !locked
  const [relationships, setRelationships] = useState<BeneficiaryRelationship[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!unlocked) {
      setRelationships((current) => (current.length === 0 ? current : []))
      setError((current) => (current === null ? current : null))
      setLoading((current) => (current ? current : true))
      return
    }

    let cancelled = false

    async function fetchRelationships() {
      let pinGate = false
      try {
        setLoading(true)
        setError(null)
        const response = await fetch("/api/beneficiaries/my-relationships")

        if (response.status === 403) {
          pinGate = true
          if (!cancelled) {
            setRelationships((current) => (current.length === 0 ? current : []))
            setError(null)
            setLoading(true)
          }
          void checkStatus()
          return
        }

        if (!response.ok) {
          throw new Error("Failed to fetch relationships")
        }

        const data = await response.json()
        if (!cancelled) {
          setRelationships(data.relationships || [])
        }
      } catch {
        if (!cancelled) {
          setError(t("error"))
        }
      } finally {
        if (!cancelled && !pinGate) {
          setLoading(false)
        }
      }
    }

    void fetchRelationships()
    return () => {
      cancelled = true
    }
  }, [unlocked, t, checkStatus])

  function formatDate(dateString: string) {
    try {
      const date = new Date(dateString)
      return format(date, "PPP", { locale: locale === "es" ? es : enUS })
    } catch {
      return dateString
    }
  }

  function getRelationshipLabel(relationshipKey: string | null) {
    if (!relationshipKey) return t("relationships.other")
    const key = `relationships.${relationshipKey}` as "relationships.other"
    return t.has(key) ? t(key) : t("relationships.other")
  }

  if (!unlocked || loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">{t("error")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("beneficiaryRelationshipsTitle")}</h1>
        <p className="mt-2 text-muted-foreground">
          {t("beneficiaryRelationshipsDescription")}
        </p>
      </div>

      {relationships.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center py-12 text-center">
            <Heart className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold">{t("noBeneficiaryRelationships")}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("noBeneficiaryRelationshipsDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {relationships.map((relationship) => (
            <Card key={relationship.beneficiary_id} className="overflow-hidden">
              <CardHeader className="bg-muted/50 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{relationship.holder_full_name}</CardTitle>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    <Badge variant="secondary" className="font-medium">
                      {getRelationshipLabel(relationship.relationship_key)}
                    </Badge>
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-medium text-muted-foreground">
                      {t("addedOn")}
                    </p>
                    <p className="text-foreground">
                      {formatDate(relationship.created_at)}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                      {t("emailVerified")}
                    </span>
                  </div>
                  {relationship.email_verified_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("verifiedOn")} {formatDate(relationship.email_verified_at)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-6">
          <div className="flex gap-4">
            <ShieldCheck className="h-6 w-6 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("beneficiaryRelationshipsInfoTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("beneficiaryRelationshipsInfoDescription")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
