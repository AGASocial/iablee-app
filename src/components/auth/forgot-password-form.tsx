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
import { useTranslations, useLocale } from "next-intl"

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
})

type FormData = z.infer<typeof formSchema>

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = React.useState(false)
  const [emailSent, setEmailSent] = React.useState(false)
  const t = useTranslations()
  const locale = useLocale()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  })

  async function onSubmit(data: FormData) {
    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: data.email,
          locale,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error === "email_rate_limit_exceeded") {
          throw new Error(t("forgotPasswordRateLimit"))
        }
        throw new Error(result.error ?? t("forgotPasswordError"))
      }

      setEmailSent(true)
    } catch (error) {
      console.error("Forgot password error:", error)
      toast.error(error instanceof Error ? error.message : t("forgotPasswordError"))
    } finally {
      setIsLoading(false)
    }
  }

  if (emailSent) {
    return (
      <div className="mx-auto flex w-full flex-col justify-center space-y-6">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("resetLinkSent")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("resetLinkSentDescription")}
          </p>
        </div>
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
          {t("forgotPasswordTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("forgotPasswordDescription")}
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder="name@example.com"
                    type="email"
                    autoComplete="email"
                    className="bg-background/80 dark:bg-background/70"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                {t("sendingResetLink")}
              </div>
            ) : (
              t("sendResetLink")
            )}
          </Button>
        </form>
      </Form>

      <p className="px-8 text-center text-sm text-muted-foreground">
        <Link href="/auth/login" className="underline underline-offset-4 hover:text-primary">
          {t("backToSignIn")}
        </Link>
      </p>
    </div>
  )
}
