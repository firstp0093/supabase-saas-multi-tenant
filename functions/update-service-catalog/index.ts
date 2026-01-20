// supabase/functions/update-service-catalog/index.ts
// Admin function to add, update, or deprecate services

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ServiceDefinition {
  id: string
  name: string
  description?: string
  category: string
  is_core?: boolean
  is_enabled?: boolean
  config_schema?: object
  docs_url?: string
  icon?: string
  sort_order?: number
  dependencies?: Array<{ service_id: string; is_required: boolean }>
}

interface UpdateRequest {
  action: 'add' | 'update' | 'deprecate' | 'enable' | 'disable' | 'remove'
  service?: ServiceDefinition
  service_id?: string
  admin_key?: string  // Simple admin verification
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { action, service, service_id, admin_key }: UpdateRequest = await req.json()
  
  // Simple admin verification (in production, use proper auth)
  if (admin_key !== Deno.env.get('ADMIN_KEY')) {
    return new Response(JSON.stringify({ error: 'Invalid admin key' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  let result: unknown
  let changelogEntry: { change_type: string; title: string; description?: string } | null = null
  
  switch (action) {
    case 'add':
      if (!service) {
        return new Response(JSON.stringify({ error: 'Service definition required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Insert service
      const { data: newService, error: insertError } = await supabase
        .from('services')
        .insert({
          id: service.id,
          name: service.name,
          description: service.description,
          category: service.category,
          is_core: service.is_core || false,
          is_enabled: service.is_enabled ?? true,
          config_schema: service.config_schema || {},
          docs_url: service.docs_url,
          icon: service.icon,
          sort_order: service.sort_order || 0
        })
        .select()
        .single()
      
      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Add dependencies if provided
      if (service.dependencies && service.dependencies.length > 0) {
        await supabase.from('service_dependencies').insert(
          service.dependencies.map(d => ({
            service_id: service.id,
            depends_on: d.service_id,
            is_required: d.is_required
          }))
        )
      }
      
      // Initialize status
      await supabase.from('service_status').insert({
        service_id: service.id,
        status: 'unknown',
        last_check_at: new Date().toISOString()
      })
      
      result = newService
      changelogEntry = {
        change_type: 'added',
        title: `New service: ${service.name}`,
        description: service.description
      }
      break
    
    case 'update':
      if (!service) {
        return new Response(JSON.stringify({ error: 'Service definition required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      const { data: updated, error: updateError } = await supabase
        .from('services')
        .update({
          name: service.name,
          description: service.description,
          category: service.category,
          is_core: service.is_core,
          config_schema: service.config_schema,
          docs_url: service.docs_url,
          icon: service.icon,
          sort_order: service.sort_order,
          updated_at: new Date().toISOString()
        })
        .eq('id', service.id)
        .select()
        .single()
      
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      result = updated
      changelogEntry = {
        change_type: 'updated',
        title: `Service updated: ${service.name}`,
        description: 'Service configuration updated'
      }
      break
    
    case 'deprecate':
    case 'disable':
      const { data: disabled } = await supabase
        .from('services')
        .update({ is_enabled: false, updated_at: new Date().toISOString() })
        .eq('id', service_id)
        .select()
        .single()
      
      result = disabled
      changelogEntry = {
        change_type: 'deprecated',
        title: `Service ${action}d: ${service_id}`,
        description: `Service is no longer available for new configurations`
      }
      break
    
    case 'enable':
      const { data: enabled } = await supabase
        .from('services')
        .update({ is_enabled: true, updated_at: new Date().toISOString() })
        .eq('id', service_id)
        .select()
        .single()
      
      result = enabled
      changelogEntry = {
        change_type: 'updated',
        title: `Service enabled: ${service_id}`,
        description: 'Service is now available'
      }
      break
    
    case 'remove':
      // Soft delete - just disable and mark in changelog
      await supabase
        .from('services')
        .update({ is_enabled: false, updated_at: new Date().toISOString() })
        .eq('id', service_id)
      
      result = { removed: service_id }
      changelogEntry = {
        change_type: 'removed',
        title: `Service removed: ${service_id}`,
        description: 'Service has been removed from the catalog'
      }
      break
    
    default:
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
  }
  
  // Log to changelog
  if (changelogEntry) {
    await supabase.from('service_changelog').insert({
      service_id: service?.id || service_id,
      ...changelogEntry
    })
  }
  
  return new Response(JSON.stringify({
    success: true,
    action,
    result
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
