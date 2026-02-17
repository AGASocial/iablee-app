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
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { useTranslations, useLocale } from "next-intl"

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters"),
  fullName: z.string().optional(),
})

type FormData = z.infer<typeof formSchema>

interface AuthFormProps {
  type: "login" | "register"
}

export function AuthForm({ type }: AuthFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = React.useState(false)
  const t = useTranslations()
  const locale = useLocale()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      fullName: "",
    },
  })

  async function onSubmit(data: FormData) {
    setIsLoading(true)

    try {
      if (type === "register") {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: data.email,
            password: data.password,
            fullName: data.fullName,
            locale,
          }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? "Registration failed")

        toast.success("Registration successful! Please check your email to verify your account.")
        router.push(`/${locale}/auth/login`)
      } else {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: data.email,
            password: data.password,
          }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? "Login failed")

        window.dispatchEvent(new Event('auth-changed'))
        toast.success("Login successful!")

        // Check if user has any assets via API
        try {
          const res = await fetch('/api/assets');
          if (res.ok) {
            const assets = await res.json();
            if (!assets || assets.length === 0) {
              router.push(`/${locale}/wizard`);
            } else {
              router.push(`/${locale}/dashboard`);
            }
          } else {
            router.push(`/${locale}/dashboard`);
          }
        } catch {
          router.push(`/${locale}/dashboard`);
        }
      }
    } catch (error) {
      console.error('Auth error:', error)
      toast.error(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    try {
      setIsLoading(true);
      const response = await fetch('/api/auth/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          locale,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? 'Failed to start Google login');
      }

      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsLoading(false);
    }
  }

  async function handleAppleSignIn() {
    try {
      setIsLoading(true);
      const response = await fetch('/api/auth/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'apple',
          locale,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? 'Failed to start Apple login');
      }

      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsLoading(false);
    }
  }

  const appleButtonUrl =
    locale === 'es'
      ? 'https://appleid.cdn-apple.com/appleid/button?height=38&width=300&color=black&locale=es_MX'
      : 'https://appleid.cdn-apple.com/appleid/button?height=38&width=300&color=black';

  return (
    <div className="mx-auto p-4 flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {type === "login" ? t("welcome") : t("createAnAccount")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {type === "login"
            ? t("enterYourCredentialsToSignInToYourAccount")
            : t("enterYourDetailsToCreateYourAccount")}
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full max-w-[300px] mx-auto flex items-center justify-center gap-2"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        <Image src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width={20} height={20} className="w-5 h-5" />
        {t("signInWithGoogle") || "Sign in with Google"}
      </Button>

      <button
        type="button"
        className="w-full max-w-[300px] mx-auto"
        onClick={handleAppleSignIn}
        disabled={isLoading}
      >
        <Image
          src={appleButtonUrl}
          alt={t("signInWithApple") || "Sign in with Apple"}
          width={300}
          height={44}
          className="w-full h-auto"
        />
      </button>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">{t("or")}</span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {type === "register" && (
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fullName")}</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input placeholder="name@example.com" type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <Input placeholder="••••••••" type="password" autoComplete={type === "login" ? "current-password" : "new-password"} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                {type === "login" ? t("signingIn") : t("creatingAccount")}
              </div>
            ) : type === "login" ? (
              t("signIn")
            ) : (
              t("createAccount")
            )}
          </Button>
        </form>
      </Form>

      <p className="px-8 text-center text-sm text-muted-foreground">
        {type === "login" ? (
          <>
            {t("dontHaveAnAccount")}
            <Link href="/auth/register" className="underline underline-offset-4 hover:text-primary">
              {t("signUp")}
            </Link>

          </>
        ) : (
          <>
            {t("alreadyHaveAnAccount")}
            <Link href="/auth/login" className="underline underline-offset-4 hover:text-primary">
              {t("signIn")}
            </Link>
          </>
        )}
      </p>

      <p className="px-8 text-center text-xs text-muted-foreground">
        {t("version")} 2.1.0
        <br />
        Copyright © 2026
      </p>
    </div>
  )
} 
