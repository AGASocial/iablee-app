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
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { useTranslations } from "next-intl"

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
        const { error: signUpError } = await supabase.auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: {
              full_name: data.fullName,
            },
          },
        })

        if (signUpError) throw signUpError

        toast.success("Registration successful! Please check your email to verify your account.")
        router.push("/auth/login")
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password,
        })

        if (signInError) throw signInError

        toast.success("Login successful!")
        router.push("/dashboard")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
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
                    <Input placeholder="John Doe" {...field} />
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
                  <Input placeholder="name@example.com" type="email" {...field} />
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
                  <Input placeholder="••••••••" type="password" {...field} />
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
    </div>
  )
} 