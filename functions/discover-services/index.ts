// supabase/functions/discover-services/index.ts
// Returns available services, their status, and tenant-specific configuration

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ServiceWithStatus {
  id: string
  name: string
  description: string
  category: string
  is_core: boolean
  is_enabled: boolean
  config_schema: object
  docs_url: string | null
  icon: string | null
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  dependencies: string[]
  tenant_config?: {
    is_enabled: boolean
    is_configured: boolean
    credentials_set: boolean
    config: object
    last_used_at: string | null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Check if user is authenticated
  const authHeader = req.headers.get('Authorization')
  let tenant_id: string | null = null
  
  if (authHeader) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    
    if (user) {
      // Get user's tenant
      const { data: userTenant } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      
      tenant_id = userTenant?.tenant_id
    }
  }
  
  // Get query params
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const includeDisabled = url.searchParams.get('include_disabled') === 'true'
  
  // Fetch all services
  let servicesQuery = supabase
    .from('services')
    .select('*')
    .order('sort_order')
  
  if (category) {
    servicesQuery = servicesQuery.eq('category', category)
  }
  
  if (!includeDisabled) {
    servicesQuery = servicesQuery.eq('is_enabled', true)
  }
  
  const { data: services, error: servicesError } = await servicesQuery
  
  if (servicesError) {
    return new Response(JSON.stringify({ error: servicesError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Fetch service status
  const { data: statuses } = await supabase
    .from('service_status')
    .select('service_id, status, last_check_at, response_time_ms')
  
  const statusMap = new Map(statuses?.map(s => [s.service_id, s]) || [])
  
  // Fetch dependencies
  const { data: dependencies } = await supabase
    .from('service_dependencies')
    .select('service_id, depends_on, is_required')
  
  const depsMap = new Map<string, string[]>()
  dependencies?.forEach(d => {
    const existing = depsMap.get(d.service_id) || []
    existing.push(d.depends_on)
    depsMap.set(d.service_id, existing)
  })
  
  // Fetch tenant-specific config if authenticated
  let tenantConfigMap = new Map()
  
  if (tenant_id) {
    const { data: tenantServices } = await supabase
      .from('tenant_services')
      .select('*')
      .eq('tenant_id', tenant_id)
    
    tenantConfigMap = new Map(tenantServices?.map(ts => [ts.service_id, ts]) || [])
  }
  
  // Build response
  const result: ServiceWithStatus[] = services.map(service => {
    const status = statusMap.get(service.id)
    const tenantConfig = tenantConfigMap.get(service.id)
    
    const serviceResult: ServiceWithStatus = {
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      is_core: service.is_core,
      is_enabled: service.is_enabled,
      config_schema: service.config_schema,
      docs_url: service.docs_url,
      icon: service.icon,
      status: status?.status || 'unknown',
      dependencies: depsMap.get(service.id) || [],
    }
    
    if (tenant_id && tenantConfig) {
      serviceResult.tenant_config = {
        is_enabled: tenantConfig.is_enabled,
        is_configured: tenantConfig.is_configured,
        credentials_set: tenantConfig.credentials_set,
        config: tenantConfig.config,
        last_used_at: tenantConfig.last_used_at,
      }
    }
    
    return serviceResult
  })
  
  // Group by category
  const categories = [...new Set(result.map(s => s.category))]
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = result.filter(s => s.category === cat)
    return acc
  }, {} as Record<string, ServiceWithStatus[]>)
  
  return new Response(JSON.stringify({
    services: result,
    by_category: grouped,
    categories: categories,
    tenant_id: tenant_id,
    total: result.length,
    configured: result.filter(s => s.tenant_config?.is_configured).length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
