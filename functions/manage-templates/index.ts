// =====================================================
// MANAGE TEMPLATES
// CRUD operations for sub-SaaS templates
// Add/edit templates without redeploying code
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  const isAdmin = adminKey === ADMIN_KEY

  // Get authenticated user
  let user: any = null
  let membership: any = null

  if (authHeader) {
    const { data: { user: authUser } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authUser) {
      user = authUser
      const { data: m } = await supabase
        .from('user_tenants')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      membership = m
    }
  }

  const body = await req.json()
  const { action } = body
  const tenantId = isAdmin ? body.tenant_id : membership?.tenant_id

  // ===== LIST TEMPLATES =====
  if (action === 'list') {
    try {
      let query = supabase
        .from('sub_saas_templates')
        .select(`
          id, slug, name, description, icon, category,
          features, is_public, is_active, version, created_at,
          schemas:template_table_schemas(count)
        `)
        .eq('is_active', true)
        .order('category')
        .order('name')

      // Filter: public templates OR tenant's private templates
      if (!isAdmin && tenantId) {
        query = query.or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      } else if (!isAdmin) {
        query = query.eq('is_public', true)
      }

      const { data, error } = await query

      if (error) throw error

      // Transform to include table count
      const templates = (data || []).map((t: any) => ({
        ...t,
        table_count: t.schemas?.[0]?.count || 0,
        schemas: undefined
      }))

      return new Response(JSON.stringify({ templates }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET TEMPLATE =====
  if (action === 'get') {
    const { template_id, slug } = body

    if (!template_id && !slug) {
      return new Response(JSON.stringify({ error: 'template_id or slug required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      let query = supabase
        .from('sub_saas_templates')
        .select(`
          *,
          schemas:template_table_schemas(*)
        `)

      if (template_id) {
        query = query.eq('id', template_id)
      } else {
        query = query.eq('slug', slug)
      }

      const { data, error } = await query.single()

      if (error) throw error

      // Check access
      if (!data.is_public && !isAdmin && data.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ template: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== CREATE TEMPLATE =====
  if (action === 'create') {
    // Must be admin or have tenant membership
    if (!isAdmin && (!membership || !['owner', 'admin'].includes(membership.role))) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const {
      slug,
      name,
      description,
      icon,
      category = 'general',
      features = [],
      default_settings = {},
      default_branding = {},
      tables = [], // Array of table schemas
      is_public = false // Only platform admin can create public templates
    } = body

    if (!slug || !name) {
      return new Response(JSON.stringify({ error: 'slug and name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Only platform admin can create public templates
    const makePublic = is_public && isAdmin

    try {
      // Check slug uniqueness
      const { data: existing } = await supabase
        .from('sub_saas_templates')
        .select('id')
        .eq('slug', slug)
        .single()

      if (existing) {
        return new Response(JSON.stringify({ error: 'Template slug already exists' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Create template
      const { data: template, error: createError } = await supabase
        .from('sub_saas_templates')
        .insert({
          slug,
          name,
          description,
          icon,
          category,
          features,
          default_settings,
          default_branding,
          is_public: makePublic,
          tenant_id: makePublic ? null : tenantId
        })
        .select()
        .single()

      if (createError) throw createError

      // Create table schemas
      if (tables.length > 0) {
        const schemas = tables.map((t: any, index: number) => ({
          template_id: template.id,
          table_name: t.table_name || t.name,
          display_name: t.display_name || t.name,
          description: t.description,
          icon: t.icon,
          columns: t.columns || [],
          indexes: t.indexes || [],
          enable_rls: t.enable_rls !== false,
          is_system: t.is_system || false,
          sort_order: t.sort_order ?? index
        }))

        const { error: schemaError } = await supabase
          .from('template_table_schemas')
          .insert(schemas)

        if (schemaError) {
          // Rollback template creation
          await supabase.from('sub_saas_templates').delete().eq('id', template.id)
          throw schemaError
        }
      }

      // Fetch complete template
      const { data: completeTemplate } = await supabase
        .from('sub_saas_templates')
        .select('*, schemas:template_table_schemas(*)')
        .eq('id', template.id)
        .single()

      return new Response(JSON.stringify({ 
        success: true, 
        template: completeTemplate 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== UPDATE TEMPLATE =====
  if (action === 'update') {
    const { template_id } = body

    if (!template_id) {
      return new Response(JSON.stringify({ error: 'template_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from('sub_saas_templates')
      .select('*')
      .eq('id', template_id)
      .single()

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check access
    if (!isAdmin && existing.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const {
      name,
      description,
      icon,
      category,
      features,
      default_settings,
      default_branding,
      is_active
    } = body

    const updates: any = { version: (existing.version || 1) + 1 }
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (icon !== undefined) updates.icon = icon
    if (category !== undefined) updates.category = category
    if (features !== undefined) updates.features = features
    if (default_settings !== undefined) updates.default_settings = default_settings
    if (default_branding !== undefined) updates.default_branding = default_branding
    if (is_active !== undefined) updates.is_active = is_active

    try {
      const { data, error } = await supabase
        .from('sub_saas_templates')
        .update(updates)
        .eq('id', template_id)
        .select()
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ success: true, template: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== DELETE TEMPLATE =====
  if (action === 'delete') {
    const { template_id } = body

    if (!template_id) {
      return new Response(JSON.stringify({ error: 'template_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from('sub_saas_templates')
      .select('*')
      .eq('id', template_id)
      .single()

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Can't delete public templates unless platform admin
    if (existing.is_public && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Cannot delete public templates' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check access
    if (!isAdmin && existing.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Soft delete by marking inactive, or hard delete private templates
      if (existing.is_public) {
        await supabase
          .from('sub_saas_templates')
          .update({ is_active: false })
          .eq('id', template_id)
      } else {
        await supabase
          .from('sub_saas_templates')
          .delete()
          .eq('id', template_id)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== ADD TABLE SCHEMA =====
  if (action === 'add_table') {
    const { template_id, table } = body

    if (!template_id || !table) {
      return new Response(JSON.stringify({ error: 'template_id and table required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from('sub_saas_templates')
      .select('*')
      .eq('id', template_id)
      .single()

    if (!existing || (!isAdmin && existing.tenant_id !== tenantId)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { data, error } = await supabase
        .from('template_table_schemas')
        .insert({
          template_id,
          table_name: table.table_name || table.name,
          display_name: table.display_name || table.name,
          description: table.description,
          icon: table.icon,
          columns: table.columns || [],
          indexes: table.indexes || [],
          enable_rls: table.enable_rls !== false,
          is_system: table.is_system || false,
          sort_order: table.sort_order || 0
        })
        .select()
        .single()

      if (error) throw error

      // Increment template version
      await supabase
        .from('sub_saas_templates')
        .update({ version: (existing.version || 1) + 1 })
        .eq('id', template_id)

      return new Response(JSON.stringify({ success: true, schema: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== UPDATE TABLE SCHEMA =====
  if (action === 'update_table') {
    const { schema_id, updates } = body

    if (!schema_id || !updates) {
      return new Response(JSON.stringify({ error: 'schema_id and updates required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership through template
    const { data: schema } = await supabase
      .from('template_table_schemas')
      .select('*, template:sub_saas_templates(*)')
      .eq('id', schema_id)
      .single()

    if (!schema || (!isAdmin && schema.template.tenant_id !== tenantId)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const allowedUpdates: any = {}
    if (updates.display_name !== undefined) allowedUpdates.display_name = updates.display_name
    if (updates.description !== undefined) allowedUpdates.description = updates.description
    if (updates.icon !== undefined) allowedUpdates.icon = updates.icon
    if (updates.columns !== undefined) allowedUpdates.columns = updates.columns
    if (updates.indexes !== undefined) allowedUpdates.indexes = updates.indexes
    if (updates.sort_order !== undefined) allowedUpdates.sort_order = updates.sort_order

    try {
      const { data, error } = await supabase
        .from('template_table_schemas')
        .update(allowedUpdates)
        .eq('id', schema_id)
        .select()
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ success: true, schema: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== DELETE TABLE SCHEMA =====
  if (action === 'delete_table') {
    const { schema_id } = body

    if (!schema_id) {
      return new Response(JSON.stringify({ error: 'schema_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership through template
    const { data: schema } = await supabase
      .from('template_table_schemas')
      .select('*, template:sub_saas_templates(*)')
      .eq('id', schema_id)
      .single()

    if (!schema || (!isAdmin && schema.template.tenant_id !== tenantId)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (schema.is_system) {
      return new Response(JSON.stringify({ error: 'Cannot delete system tables' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      await supabase
        .from('template_table_schemas')
        .delete()
        .eq('id', schema_id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response(JSON.stringify({
    error: 'Invalid action',
    available_actions: [
      'list', 'get', 'create', 'update', 'delete',
      'add_table', 'update_table', 'delete_table'
    ]
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
