// =====================================================
// MANAGE EDGE FUNCTIONS
// Create, update, delete Edge Functions programmatically
// For AI-driven infrastructure management
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

// Supabase Management API base URL
const SUPABASE_PROJECT_REF = Deno.env.get('SUPABASE_URL')!.match(/https:\/\/([^.]+)/)?.[1]
const MANAGEMENT_API = 'https://api.supabase.com/v1'
const BASE_ACCESS_TOKEN = Deno.env.get('BASE_ACCESS_TOKEN')!  // Personal access token from supabase.com/dashboard/account/tokens
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  // Require admin key for all operations
  const adminKey = req.headers.get('X-Admin-Key')
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized - Admin key required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { action, function_name, function_code, verify_jwt, import_map } = await req.json()
  
  const headers = {
    'Authorization': `Bearer ${BASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
  
  // ===== LIST FUNCTIONS =====
  if (action === 'list') {
    try {
      const response = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/functions`,
        { headers }
      )
      
      const functions = await response.json()
      
      return new Response(JSON.stringify({
        success: true,
        functions: functions.map((f: any) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          status: f.status,
          version: f.version,
          created_at: f.created_at,
          updated_at: f.updated_at,
          verify_jwt: f.verify_jwt
        })),
        count: functions.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== GET FUNCTION DETAILS =====
  if (action === 'get') {
    if (!function_name) {
      return new Response(JSON.stringify({ error: 'function_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const response = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/functions/${function_name}`,
        { headers }
      )
      
      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Function not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      const func = await response.json()
      
      return new Response(JSON.stringify({ success: true, function: func }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== CREATE FUNCTION =====
  if (action === 'create') {
    if (!function_name || !function_code) {
      return new Response(JSON.stringify({ error: 'function_name and function_code required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Validate function name (slug format)
    if (!/^[a-z0-9-]+$/.test(function_name)) {
      return new Response(JSON.stringify({ error: 'Function name must be lowercase alphanumeric with hyphens' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Create the function
      const createResponse = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/functions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: function_name,
            slug: function_name,
            verify_jwt: verify_jwt !== false,  // Default true
            body: function_code,
            import_map: import_map || null
          })
        }
      )
      
      const result = await createResponse.json()
      
      if (!createResponse.ok) {
        return new Response(JSON.stringify({ error: result.message || 'Failed to create function' }), {
          status: createResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Log the action
      await supabase.from('activity_log').insert({
        action: 'function.created',
        resource_type: 'edge_function',
        resource_id: result.id,
        metadata: { function_name, verify_jwt: verify_jwt !== false }
      })
      
      return new Response(JSON.stringify({
        success: true,
        function: result,
        url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/${function_name}`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== UPDATE FUNCTION =====
  if (action === 'update') {
    if (!function_name || !function_code) {
      return new Response(JSON.stringify({ error: 'function_name and function_code required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const updateResponse = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/functions/${function_name}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            body: function_code,
            verify_jwt: verify_jwt,
            import_map: import_map
          })
        }
      )
      
      const result = await updateResponse.json()
      
      if (!updateResponse.ok) {
        return new Response(JSON.stringify({ error: result.message || 'Failed to update function' }), {
          status: updateResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Log the action
      await supabase.from('activity_log').insert({
        action: 'function.updated',
        resource_type: 'edge_function',
        metadata: { function_name }
      })
      
      return new Response(JSON.stringify({ success: true, function: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DELETE FUNCTION =====
  if (action === 'delete') {
    if (!function_name) {
      return new Response(JSON.stringify({ error: 'function_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Prevent deleting critical functions
    const protectedFunctions = ['manage-functions', 'manage-secrets', 'manage-database']
    if (protectedFunctions.includes(function_name)) {
      return new Response(JSON.stringify({ error: 'Cannot delete protected infrastructure function' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const deleteResponse = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/functions/${function_name}`,
        {
          method: 'DELETE',
          headers
        }
      )
      
      if (!deleteResponse.ok) {
        const error = await deleteResponse.json()
        return new Response(JSON.stringify({ error: error.message || 'Failed to delete function' }), {
          status: deleteResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Log the action
      await supabase.from('activity_log').insert({
        action: 'function.deleted',
        resource_type: 'edge_function',
        metadata: { function_name }
      })
      
      return new Response(JSON.stringify({ success: true, deleted: function_name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  return new Response(JSON.stringify({ error: 'Invalid action. Use: list, get, create, update, delete' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
