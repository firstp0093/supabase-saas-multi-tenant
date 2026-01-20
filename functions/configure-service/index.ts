// supabase/functions/configure-service/index.ts
// Enable, disable, or configure a service for a tenant

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConfigureRequest {
  service_id: string
  action: 'enable' | 'disable' | 'configure' | 'mark_configured'
  config?: Record<string, unknown>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Authenticate
  const authHeader = req.headers.get('Authorization')!
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Get tenant
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Only owners and admins can configure services
  if (!['owner', 'admin'].includes(userTenant.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { service_id, action, config }: ConfigureRequest = await req.json()
  
  // Verify service exists and is enabled platform-wide
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('*')
    .eq('id', service_id)
    .single()
  
  if (serviceError || !service) {
    return new Response(JSON.stringify({ error: 'Service not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  if (!service.is_enabled) {
    return new Response(JSON.stringify({ error: 'Service is not available' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Can't disable core services
  if (service.is_core && action === 'disable') {
    return new Response(JSON.stringify({ error: 'Cannot disable core service' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Check dependencies for enable
  if (action === 'enable') {
    const { data: deps } = await supabase
      .from('service_dependencies')
      .select('depends_on')
      .eq('service_id', service_id)
      .eq('is_required', true)
    
    if (deps && deps.length > 0) {
      const { data: tenantServices } = await supabase
        .from('tenant_services')
        .select('service_id')
        .eq('tenant_id', userTenant.tenant_id)
        .eq('is_enabled', true)
        .in('service_id', deps.map(d => d.depends_on))
      
      const enabledDeps = new Set(tenantServices?.map(ts => ts.service_id) || [])
      const missingDeps = deps.filter(d => !enabledDeps.has(d.depends_on))
      
      if (missingDeps.length > 0) {
        return new Response(JSON.stringify({ 
          error: 'Missing required dependencies',
          missing: missingDeps.map(d => d.depends_on)
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }
  }
  
  // Build update object
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }
  
  switch (action) {
    case 'enable':
      updates.is_enabled = true
      break
    case 'disable':
      updates.is_enabled = false
      break
    case 'configure':
      if (config) {
        updates.config = config
      }
      break
    case 'mark_configured':
      updates.is_configured = true
      updates.credentials_set = true
      break
  }
  
  // Upsert tenant_services
  const { data: result, error: upsertError } = await supabase
    .from('tenant_services')
    .upsert({
      tenant_id: userTenant.tenant_id,
      service_id: service_id,
      ...updates
    }, {
      onConflict: 'tenant_id,service_id'
    })
    .select()
    .single()
  
  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  return new Response(JSON.stringify({
    success: true,
    service_id,
    action,
    tenant_service: result
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
