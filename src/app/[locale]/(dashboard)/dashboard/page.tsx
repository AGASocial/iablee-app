import { fetchDashboardData } from '@/lib/server/data';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const initialData = await fetchDashboardData();
  return <DashboardClient initialData={initialData ?? undefined} />;
}
