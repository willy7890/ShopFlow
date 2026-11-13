import type { SQLiteDatabase } from 'expo-sqlite'
import { authenticatedApiRequest } from './api.ts'

export interface PlatformAnalytics {
  business_count: number
  active_business_count: number
  user_count: number
  active_subscription_count: number
  pending_subscription_count: number
  confirmed_subscription_revenue: string | null
  currency: string | null
}

export interface PlatformBusiness {
  id: string
  name: string
  business_type: string
  currency: string
  is_active: boolean
  subscription: {
    id: string
    plan_id: string | null
    status: string
    expires_at: string | null
  } | null
}

export interface PlatformUser {
  id: string
  full_name: string
  email: string
  phone: string | null
  is_active: boolean
  is_super_admin: boolean
  created_at: string
}

export interface PlatformPlan {
  id: string
  slug: string
  name: string
  price: string
  currency: string
  duration_days: number
  is_active: boolean
}

export interface PlatformAuditEvent {
  id: string
  business_id: string | null
  user_id: string | null
  event_type: string
  details: Record<string, unknown>
  created_at: string
}

export interface PlatformAdminData {
  analytics: PlatformAnalytics
  businesses: PlatformBusiness[]
  users: PlatformUser[]
  plans: PlatformPlan[]
  audit: PlatformAuditEvent[]
}

export async function fetchPlatformAdminData(database: SQLiteDatabase): Promise<PlatformAdminData> {
  const [analytics, businesses, users, plans, audit] = await Promise.all([
    authenticatedApiRequest<PlatformAnalytics>(database, '/subscriptions/admin/analytics'),
    authenticatedApiRequest<PlatformBusiness[]>(database, '/subscriptions/admin/businesses?offset=0&limit=100'),
    authenticatedApiRequest<PlatformUser[]>(database, '/subscriptions/admin/users?offset=0&limit=100'),
    authenticatedApiRequest<PlatformPlan[]>(database, '/subscriptions/plans?active_only=false'),
    authenticatedApiRequest<PlatformAuditEvent[]>(database, '/subscriptions/admin/audit-logs?offset=0&limit=100'),
  ])
  return { analytics, businesses, users, plans, audit }
}
