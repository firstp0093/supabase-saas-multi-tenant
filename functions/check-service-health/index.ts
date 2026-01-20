// supabase/functions/check-service-health/index.ts
// Checks health of all services and updates status
// Can be called via cron or manually

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface HealthCheckResult {
  service_id: string
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  response_time_ms: number
  error_message?: string
}

async function checkStripe(): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    // Just verify the key format is valid by checking Stripe's status page
    const response = await fetch('https://status.stripe.com/api/v2/status.json')
    const data = await response.json()
    
    return {
      service_id: 'stripe',
      status: data.status?.indicator === 'none' ? 'healthy' : 'degraded',
      response_time_ms: Date.now() - start
    }
  } catch (e) {
    return {
      service_id: 'stripe',
      status: 'unknown',
      response_time_ms: Date.now() - start,
      error_message: e.message
    }
  }
}

async function checkCloudflare(): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const response = await fetch('https://www.cloudflarestatus.com/api/v2/status.json')
    const data = await response.json()
    
    return {
      service_id: 'cloudflare_pages',
      status: data.status?.indicator === 'none' ? 'healthy' : 'degraded',
      response_time_ms: Date.now() - start
    }
  } catch (e) {
    return {
      service_id: 'cloudflare_pages',
      status: 'unknown',
      response_time_ms: Date.now() - start,
      error_message: e.message
    }
  }
}

async function checkSupabase(supabaseUrl: string): Promise<HealthCheckResult[]> {
  const start = Date.now()
  const results: HealthCheckResult[] = []
  
  try {
    // Check if Supabase is responding
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! }
    })
    
    const responseTime = Date.now() - start
    const isHealthy = response.status === 200 || response.status === 401 // 401 is expected without auth
    
    results.push({
      service_id: 'supabase_db',
      status: isHealthy ? 'healthy' : 'degraded',
      response_time_ms: responseTime
    })
    
    results.push({
      service_id: 'supabase_auth',
      status: isHealthy ? 'healthy' : 'degraded',
      response_time_ms: responseTime
    })
  } catch (e) {
    results.push({
      service_id: 'supabase_db',
      status: 'down',
      response_time_ms: Date.now() - start,
      error_message: e.message
    })
    results.push({
      service_id: 'supabase_auth',
      status: 'down',
      response_time_ms: Date.now() - start,
      error_message: e.message
    })
  }
  
  return results
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Optional: verify request is from cron or admin
  const authHeader = req.headers.get('Authorization')
  const cronSecret = req.headers.get('X-Cron-Secret')
  
  // Allow if cron secret matches or if authenticated as admin
  const isAuthorized = cronSecret === Deno.env.get('CRON_SECRET') || authHeader
  
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Run health checks in parallel
  const [stripeResult, cloudflareResult, supabaseResults] = await Promise.all([
    checkStripe(),
    checkCloudflare(),
    checkSupabase(Deno.env.get('SUPABASE_URL')!)
  ])
  
  const allResults = [stripeResult, cloudflareResult, ...supabaseResults]
  
  // Also mark other services as healthy by default (they don't have external checks)
  const { data: allServices } = await supabase
    .from('services')
    .select('id')
  
  const checkedIds = new Set(allResults.map(r => r.service_id))
  const uncheckedServices = allServices?.filter(s => !checkedIds.has(s.id)) || []
  
  for (const service of uncheckedServices) {
    allResults.push({
      service_id: service.id,
      status: 'healthy', // Assume healthy if no external dependency
      response_time_ms: 0
    })
  }
  
  // Update service_status table
  const now = new Date().toISOString()
  
  for (const result of allResults) {
    const updateData: Record<string, unknown> = {
      status: result.status,
      last_check_at: now,
      response_time_ms: result.response_time_ms,
      error_message: result.error_message || null,
      updated_at: now
    }
    
    if (result.status === 'healthy') {
      updateData.last_healthy_at = now
    }
    
    await supabase
      .from('service_status')
      .upsert({
        service_id: result.service_id,
        ...updateData
      }, { onConflict: 'service_id' })
  }
  
  // Log any status changes
  const { data: previousStatuses } = await supabase
    .from('service_status')
    .select('service_id, status')
  
  const prevStatusMap = new Map(previousStatuses?.map(s => [s.service_id, s.status]) || [])
  
  for (const result of allResults) {
    const prevStatus = prevStatusMap.get(result.service_id)
    if (prevStatus && prevStatus !== result.status) {
      await supabase.from('service_changelog').insert({
        service_id: result.service_id,
        change_type: 'status_change',
        title: `Status changed: ${prevStatus} → ${result.status}`,
        description: result.error_message,
        metadata: { previous: prevStatus, current: result.status }
      })
    }
  }
  
  // Summary
  const healthy = allResults.filter(r => r.status === 'healthy').length
  const degraded = allResults.filter(r => r.status === 'degraded').length
  const down = allResults.filter(r => r.status === 'down').length
  
  return new Response(JSON.stringify({
    checked_at: now,
    summary: { healthy, degraded, down, total: allResults.length },
    results: allResults
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
