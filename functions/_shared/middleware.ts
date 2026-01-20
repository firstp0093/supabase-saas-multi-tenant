// =====================================================
// REQUEST MIDDLEWARE
// Wraps Edge Functions with security & error handling
// =====================================================

import {
  getCorsHeaders,
  handleCors,
  checkRateLimit,
  getRateLimitHeaders,
  authenticateRequest,
  validateApiKey,
  createServiceClient,
  jsonResponse,
  errorResponse,
  getClientIp,
  AuthResult
} from './security.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface RequestContext {
  req: Request
  supabase: SupabaseClient
  auth: AuthResult
  body: any
  clientIp: string
  corsHeaders: Record<string, string>
}

export interface HandlerOptions {
  requireAuth?: boolean
  requireTenant?: boolean
  allowedRoles?: string[]
  allowApiKey?: boolean
  rateLimit?: number  // requests per minute
  rateLimitByTenant?: boolean
}

type Handler = (ctx: RequestContext) => Promise<Response>

export function createHandler(handler: Handler, options: HandlerOptions = {}) {
  const {
    requireAuth = true,
    requireTenant = true,
    allowedRoles,
    allowApiKey = false,
    rateLimit = 100,
    rateLimitByTenant = false
  } = options

  return async (req: Request): Promise<Response> => {
    // CORS
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse
    
    const corsHeaders = getCorsHeaders(req)
    const supabase = createServiceClient()
    const clientIp = getClientIp(req)
    
    try {
      // Rate limiting
      const rateLimitKey = `${clientIp}:${new URL(req.url).pathname}`
      const rateLimitResult = checkRateLimit(rateLimitKey, rateLimit)
      
      if (!rateLimitResult.allowed) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { ...corsHeaders, ...getRateLimitHeaders(rateLimitResult), 'Content-Type': 'application/json' }
        })
      }
      
      // Authentication
      let auth: AuthResult = { user: null, tenant: null, role: null, error: null }
      
      if (allowApiKey && req.headers.get('X-API-Key')) {
        const apiKeyResult = await validateApiKey(req, supabase)
        if (apiKeyResult.valid) {
          auth = {
            user: { id: 'api-key' },
            tenant: apiKeyResult.tenant,
            role: 'api',
            error: null
          }
        } else {
          return new Response(JSON.stringify({ error: apiKeyResult.error }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      } else if (requireAuth) {
        auth = await authenticateRequest(req, supabase)
        
        if (auth.error) {
          return new Response(JSON.stringify({ error: auth.error }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        
        if (requireTenant && !auth.tenant) {
          return new Response(JSON.stringify({ error: 'No tenant found. Create one first.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        
        if (allowedRoles && auth.role && !allowedRoles.includes(auth.role)) {
          return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
      
      // Parse body
      let body = {}
      if (req.method !== 'GET' && req.headers.get('content-type')?.includes('application/json')) {
        try {
          body = await req.json()
        } catch {
          body = {}
        }
      }
      
      // Execute handler
      const ctx: RequestContext = { req, supabase, auth, body, clientIp, corsHeaders }
      const response = await handler(ctx)
      
      // Add CORS headers to response
      const newHeaders = new Headers(response.headers)
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v))
      Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(([k, v]) => newHeaders.set(k, v))
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      })
      
    } catch (error) {
      console.error('Handler error:', error)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
}
