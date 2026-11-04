"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { es, enUS } from "date-fns/locale"
import { useLocale } from "next-intl"
import { ShieldCheck, ShieldAlert, Calendar, User, Heart } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface BeneficiaryRelationship {
  holder_id: string
  holder_full_name: string
  holder_email: string
  relationship_id: number | null
  beneficiary_id: string
  email_verified: boolean
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

const RELATIONSHIPS_MAP: Record<number, string> = {
  1: "relationships.father",
  2: "relationships.mother",
  3: "relationships.son",
  4: "relationships.daughter",
  5: "relationships.grandfather",
  6: "relationships.grandmother",
  7: "relationships.brother",
  8: "relationships.sister",
  9: "relationships.spouse",
  10: "relationships.father-in-law",
  11: "relationships.mother-in-law",
  12: "relationships.stepbrother",
  13: "relationships.stepsister",
  14: "relationships.stepfather",
  15: "relationships.stepmother",
  16: "relationships.aunt",
  17: "relationships.uncle",
  18: "relationships.niece",
  19: "relationships.nephew",
  20: "relationships.cousin",
  21: "relationships.grandchild",
  22: "relationships.friend",
  23: "relationships.other",
}

export default function MyBeneficiaryRelationshipsPage() {
  const t = useTranslations()
  const locale = useLocale()
  const [relationships, setRelationships] = useState<BeneficiaryRelationship[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRelationships()
  }, [])

  async function fetchRelationships() {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch("/api/beneficiaries/my-relationships")
      
      if (!response.ok) {
        throw new Error("Failed to fetch relationships")
      }

      const data = await response.json()
      setRelationships(data.relationships || [])
    } catch (err) {
      console.error("Error fetching relationships:", err)
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateString: string) {
    try {
      const date = new Date(dateString)
      return format(date, "PPP", { locale: locale === "es" ? es : enUS })
    } catch {
      return dateString
    }
  }

  function getRelationshipLabel(relationshipId: number | null) {
    if (!relationshipId) return t("relationships.other")
    const key = RELATIONSHIPS_MAP[relationshipId]
    if (!key) return t("relationships.other")
    
    // Split the key to access nested translation
    const parts = key.split('.')
    if (parts.length === 2 && parts[0] === 'relationships') {
      return t(`relationships.${parts[1]}` as 'relationships.father')
    }
    return t("relationships.other")
  }

  if (loading) {
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
                  {relationship.email_verified ? (
                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    <Badge variant="secondary" className="font-medium">
                      {getRelationshipLabel(relationship.relationship_id)}
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
                    {relationship.email_verified ? (
                      <>
                        <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          {t("emailVerified")}
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                          {t("emailNotVerified")}
                        </span>
                      </>
                    )}
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
