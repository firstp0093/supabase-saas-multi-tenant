// =====================================================
// SHARED SECURITY UTILITIES
// Import in any Edge Function: import { ... } from '../_shared/security.ts'
// =====================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ----- CORS -----
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  Deno.env.get('APP_URL') || 'https://your-app.com',
]

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  return null
}

// ----- RATE LIMITING -----
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(
  identifier: string,
  limit: number = 100,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const record = rateLimitStore.get(identifier)
  
  if (!record || now > record.resetAt) {
    rateLimitStore.set(identifier, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetIn: windowMs }
  }
  
  record.count++
  const remaining = Math.max(0, limit - record.count)
  const resetIn = record.resetAt - now
  
  return { allowed: record.count <= limit, remaining, resetIn }
}

export function getRateLimitHeaders(result: { remaining: number; resetIn: number }) {
  return {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetIn / 1000).toString(),
  }
}

// ----- AUTHENTICATION -----
export interface AuthResult {
  user: { id: string; email?: string } | null
  tenant: { id: string; name: string; slug: string; plan: string } | null
  role: string | null
  error: string | null
}

export async function authenticateRequest(
  req: Request,
  supabase: SupabaseClient
): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, tenant: null, role: null, error: 'Missing authorization header' }
  }
  
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  
  if (error || !user) {
    return { user: null, tenant: null, role: null, error: 'Invalid or expired token' }
  }
  
  // Get default tenant
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, tenants(id, name, slug, plan)')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant) {
    return { user: { id: user.id, email: user.email }, tenant: null, role: null, error: null }
  }
  
  return {
    user: { id: user.id, email: user.email },
    tenant: userTenant.tenants as any,
    role: userTenant.role,
    error: null
  }
}

// ----- ROLE CHECKS -----
export function requireRole(auth: AuthResult, allowedRoles: string[]): Response | null {
  if (!auth.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  if (!auth.tenant) {
    return jsonResponse({ error: 'No tenant found' }, 400)
  }
  if (!auth.role || !allowedRoles.includes(auth.role)) {
    return jsonResponse({ error: 'Insufficient permissions' }, 403)
  }
  return null
}

// ----- API KEY VALIDATION -----
export async function validateApiKey(
  req: Request,
  supabase: SupabaseClient
): Promise<{ valid: boolean; tenant: any; scopes: string[]; error?: string }> {
  const apiKey = req.headers.get('X-API-Key')
  
  if (!apiKey) {
    return { valid: false, tenant: null, scopes: [], error: 'No API key provided' }
  }
  
  const keyHash = await hashString(apiKey)
  
  const { data: keyRecord } = await supabase
    .from('api_keys')
    .select('*, tenants(id, name, slug, plan)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()
  
  if (!keyRecord) {
    return { valid: false, tenant: null, scopes: [], error: 'Invalid API key' }
  }
  
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return { valid: false, tenant: null, scopes: [], error: 'API key expired' }
  }
  
  // Update last used
  await supabase.from('api_keys').update({
    last_used_at: new Date().toISOString(),
    last_used_ip: getClientIp(req)
  }).eq('id', keyRecord.id)
  
  return { valid: true, tenant: keyRecord.tenants, scopes: keyRecord.scopes || [] }
}

// ----- ADMIN KEY -----
export function validateAdminKey(providedKey: string): boolean {
  const adminKey = Deno.env.get('ADMIN_KEY')
  if (!adminKey || !providedKey) return false
  
  // Constant-time comparison
  if (adminKey.length !== providedKey.length) return false
  let result = 0
  for (let i = 0; i < adminKey.length; i++) {
    result |= adminKey.charCodeAt(i) ^ providedKey.charCodeAt(i)
  }
  return result === 0
}

// ----- UTILITIES -----
export function getClientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
}

export async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function jsonResponse(
  data: any,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  })
}

export function errorResponse(
  message: string,
  status: number = 400,
  code?: string
): Response {
  return jsonResponse({ error: message, ...(code && { code }) }, status)
}

// ----- INPUT VALIDATION -----
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  return slug.length >= 3 && slug.length <= 50 && slugRegex.test(slug)
}

export function sanitizeString(str: string, maxLength: number = 255): string {
  return str.trim().slice(0, maxLength).replace(/<[^>]*>/g, '')
}

// ----- SUPABASE CLIENT -----
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}
