"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"

const formSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100, "Password must be less than 100 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type FormData = z.infer<typeof formSchema>

export function ResetPasswordForm() {
  const router = useRouter()
  const [isLoading, setIsLoading] = React.useState(false)
  const [sessionChecked, setSessionChecked] = React.useState(false)
  const [hasSession, setHasSession] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const t = useTranslations()
  const locale = useLocale()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  })

  React.useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "include",
        })

        if (!response.ok) {
          setHasSession(false)
          return
        }

        const data = await response.json()
        setHasSession(Boolean(data.authenticated))
      } catch {
        setHasSession(false)
      } finally {
        setSessionChecked(true)
      }
    }

    void checkSession()
  }, [])

  async function onSubmit(data: FormData) {
    setIsLoading(true)
    setSubmitError(null)

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: data.password }),
      })

      const result = await response.json()

      if (!response.ok) {
        const message = typeof result.error === "string" ? result.error : t("resetPasswordError")
        setSubmitError(message)
        form.setError("password", { message })
        toast.error(message)
        return
      }

      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })

      toast.success(t("passwordResetSuccess"))
      router.push(`/${locale}/auth/login`)
    } catch (error) {
      console.error("Reset password error:", error)
      const message = error instanceof Error ? error.message : t("resetPasswordError")
      setSubmitError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (!sessionChecked) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="mx-auto flex w-full flex-col justify-center space-y-6">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("invalidOrExpiredResetLink")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("invalidOrExpiredResetLinkDescription")}
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/auth/forgot-password">{t("sendResetLink")}</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/login">{t("backToSignIn")}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("resetPasswordTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("resetPasswordDescription")}
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("newPassword")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder="••••••••"
                    type="password"
                    autoComplete="new-password"
                    className="bg-background/80 dark:bg-background/70"
                    {...field}
                    onChange={(e) => {
                      setSubmitError(null)
                      field.onChange(e)
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("confirmPassword")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder="••••••••"
                    type="password"
                    autoComplete="new-password"
                    className="bg-background/80 dark:bg-background/70"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {submitError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                {t("updatingPassword")}
              </div>
            ) : (
              t("updatePassword")
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
