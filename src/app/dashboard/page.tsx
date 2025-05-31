"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { Database } from "@/lib/supabase"
import { PlusCircle, User, Layers, BadgeCheck, Clock, XCircle } from "lucide-react"

// Helper for status badge
function StatusBadge({ status }: { status: string }) {
  let color = "bg-gray-200 text-gray-700"
  let label = status
  if (status === "Assigned") color = "bg-green-100 text-green-800"
  if (status === "Pending") color = "bg-yellow-100 text-yellow-800"
  if (status === "Unassigned") color = "bg-red-100 text-red-800"
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${color}`}>{label}</span>
  )
}

type DigitalAsset = Database["public"]["Tables"]["digital_assets"]["Row"]
type Beneficiary = Database["public"]["Tables"]["beneficiaries"]["Row"]

export default function DashboardPage() {
  const [assets, setAssets] = React.useState<DigitalAsset[]>([])
  const [beneficiaries, setBeneficiaries] = React.useState<Beneficiary[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Fetch digital assets
        const { data: assetsData } = await supabase
          .from("digital_assets")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5)

        // Fetch beneficiaries
        const { data: beneficiariesData } = await supabase
          .from("beneficiaries")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5)

        setAssets(assetsData || [])
        setBeneficiaries(beneficiariesData || [])
      } catch (error) {
        console.error("Error fetching dashboard data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div className="flex-1 space-y-8 p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        
      </div>
      <div className="grid gap-6 grid-cols-2 lg:grid-cols-2">
        <Card className="shadow-lg mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Your Digital Assets</CardTitle>
              <CardDescription>Overview of your digital assets</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> Add Asset
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <XCircle className="h-10 w-10 text-gray-400 mb-2" />
                <p className="text-center text-sm text-muted-foreground">
                  No digital assets added yet. Add your first digital asset to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Asset Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Added</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {assets.map((asset) => (
                      <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                        <td className="px-4 py-2 font-medium">{asset.asset_name}</td>
                        <td className="px-4 py-2">{asset.asset_type}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={"Assigned"} />
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {new Date(asset.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 flex gap-2">
                          <Button size="sm" variant="outline">Edit</Button>
                          <Button size="sm" variant="destructive">Delete</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-lg mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Beneficiaries</CardTitle>
              <CardDescription>Your most recently added beneficiaries</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> Add Beneficiary
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : beneficiaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <XCircle className="h-10 w-10 text-gray-400 mb-2" />
                <p className="text-center text-sm text-muted-foreground">
                  No beneficiaries added yet. Add your first beneficiary to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Relationship</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Added</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {beneficiaries.map((b) => (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                        <td className="px-4 py-2 font-medium">{b.beneficiary_name}</td>
                        <td className="px-4 py-2">{b.relationship}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={"Active"} />
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {new Date(b.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 flex gap-2">
                          <Button size="sm" variant="outline">Edit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
} 