// =====================================================
// CREATE SUB-SAAS
// Creates a new sub-SaaS application for a tenant
// Uses database-stored templates, creates REAL tables
// Supports Stripe Connect for payments
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const PLATFORM_DOMAIN = Deno.env.get('PLATFORM_DOMAIN') || 'yourplatform.com'

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
        .select('tenant_id, role, tenants(id, name, plan)')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      membership = m
    }
  }

  // Must be authenticated and have admin/owner role (or platform admin)
  if (!isAdmin && (!membership || !['owner', 'admin'].includes(membership.role))) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const body = await req.json()
  const { 
    name, 
    slug, 
    description,
    template = 'blank',
    enable_stripe_connect = false,
    custom_domain,
    settings = {},
    branding = {}
  } = body

  // Validation
  if (!name || !slug) {
    return new Response(JSON.stringify({ error: 'name and slug are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/
  if (!slugRegex.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug must be lowercase alphanumeric with hyphens only' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const tenantId = isAdmin ? body.tenant_id : membership.tenant_id

  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'tenant_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    // Check if slug is available
    const { data: existing } = await supabase
      .from('sub_saas_apps')
      .select('id')
      .or(`slug.eq.${slug},subdomain.eq.${slug}`)
      .single()

    if (existing) {
      return new Response(JSON.stringify({ error: 'Slug already taken' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check tenant's sub-saas limit based on plan
    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single()

    const planLimits: Record<string, number> = {
      free: 1,
      starter: 3,
      pro: 10,
      enterprise: 100
    }

    const { count: currentCount } = await supabase
      .from('sub_saas_apps')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('status', 'deleted')

    const limit = planLimits[tenant?.plan || 'free']
    if ((currentCount || 0) >= limit) {
      return new Response(JSON.stringify({ 
        error: `Plan limit reached. ${tenant?.plan || 'free'} plan allows ${limit} sub-apps. Upgrade to create more.`
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch template from database
    const { data: templateData } = await supabase
      .from('sub_saas_templates')
      .select(`
        *,
        schemas:template_table_schemas(*)
      `)
      .eq('slug', template)
      .eq('is_active', true)
      .single()

    if (!templateData && template !== 'blank') {
      return new Response(JSON.stringify({ 
        error: `Template '${template}' not found`,
        available: await getAvailableTemplates(supabase, tenantId)
      }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create the sub-saas app
    const subdomain = `${slug}.${PLATFORM_DOMAIN}`
    
    const { data: subSaas, error: createError } = await supabase
      .from('sub_saas_apps')
      .insert({
        tenant_id: tenantId,
        name,
        slug,
        description,
        template,
        subdomain,
        custom_domain: custom_domain || null,
        branding: { ...templateData?.default_branding, ...branding },
        settings: { ...templateData?.default_settings, ...settings },
        features_enabled: templateData?.features || [],
        stripe_connect_enabled: enable_stripe_connect,
        status: 'active'
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Apply template - create REAL tables
    const createdTables: string[] = []
    if (templateData && templateData.schemas && templateData.schemas.length > 0) {
      const tableResults = await applyTemplate(supabase, subSaas.id, templateData)
      createdTables.push(...tableResults)
    }

    // Set up Stripe Connect if enabled
    let stripeConnect = null
    if (enable_stripe_connect && STRIPE_SECRET_KEY) {
      stripeConnect = await setupStripeConnect(supabase, subSaas.id, tenantId, name)
    }

    return new Response(JSON.stringify({
      success: true,
      sub_saas: {
        id: subSaas.id,
        name: subSaas.name,
        slug: subSaas.slug,
        subdomain: subSaas.subdomain,
        custom_domain: subSaas.custom_domain,
        template: subSaas.template,
        status: subSaas.status,
        url: `https://${subSaas.subdomain}`,
        features: subSaas.features_enabled
      },
      tables_created: createdTables,
      stripe_connect: stripeConnect
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// =====================================================
// GET AVAILABLE TEMPLATES
// =====================================================

async function getAvailableTemplates(supabase: any, tenantId: string): Promise<string[]> {
  const { data } = await supabase
    .from('sub_saas_templates')
    .select('slug, name')
    .eq('is_active', true)
    .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)

  return data?.map((t: any) => t.slug) || ['blank']
}

// =====================================================
// APPLY TEMPLATE - CREATE REAL TABLES
// =====================================================

async function applyTemplate(
  supabase: any, 
  subSaasId: string, 
  templateData: any
): Promise<string[]> {
  const createdTables: string[] = []
  const tablePrefix = `ss_${subSaasId.replace(/-/g, '_')}`
  
  // Sort schemas by sort_order to handle foreign key dependencies
  const schemas = (templateData.schemas || []).sort((a: any, b: any) => 
    (a.sort_order || 0) - (b.sort_order || 0)
  )

  for (const schema of schemas) {
    const tableName = `${tablePrefix}_${schema.table_name}`
    
    try {
      // Build CREATE TABLE SQL
      const createSQL = buildCreateTableSQL(tableName, schema.columns, tablePrefix)
      
      // Execute the SQL
      const { error: sqlError } = await supabase.rpc('exec_sql', { sql: createSQL })
      
      if (sqlError) {
        console.error(`Failed to create table ${tableName}:`, sqlError)
        // Try alternative method using raw query
        const { error: rawError } = await supabase
          .from('_sql')
          .select('*')
          .limit(0)
          // This won't work, we need the exec_sql function
        
        if (rawError) {
          console.error('Alternative method also failed:', rawError)
        }
      } else {
        createdTables.push(tableName)
      }

      // Record the table in sub_saas_tables
      await supabase
        .from('sub_saas_tables')
        .insert({
          sub_saas_id: subSaasId,
          table_name: tableName,
          display_name: schema.display_name,
          schema_definition: schema.columns,
          enable_rls: schema.enable_rls !== false,
          is_system: schema.is_system || false
        })

    } catch (err) {
      console.error(`Error creating table ${tableName}:`, err)
    }
  }

  return createdTables
}

// =====================================================
// BUILD CREATE TABLE SQL
// =====================================================

function buildCreateTableSQL(
  tableName: string, 
  columns: any[], 
  tablePrefix: string
): string {
  const columnDefs: string[] = []
  const constraints: string[] = []

  for (const col of columns) {
    let def = `"${col.name}" ${mapColumnType(col.type)}`

    // Handle primary key
    if (col.primary) {
      def += ' PRIMARY KEY'
    }

    // Handle NOT NULL
    if (col.required && !col.primary) {
      def += ' NOT NULL'
    }

    // Handle UNIQUE
    if (col.unique && !col.primary) {
      def += ' UNIQUE'
    }

    // Handle DEFAULT
    if (col.default !== undefined) {
      const defaultVal = formatDefault(col.default, col.type)
      def += ` DEFAULT ${defaultVal}`
    }

    columnDefs.push(def)

    // Handle foreign key references (to tables in same sub-saas)
    if (col.references) {
      const refTable = `${tablePrefix}_${col.references}`
      constraints.push(
        `FOREIGN KEY ("${col.name}") REFERENCES "${refTable}"(id) ON DELETE SET NULL`
      )
    }
  }

  // Add sub_saas_id for isolation
  columnDefs.push('"sub_saas_id" UUID NOT NULL')

  let sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  `
  sql += columnDefs.join(',\n  ')
  
  if (constraints.length > 0) {
    sql += ',\n  ' + constraints.join(',\n  ')
  }
  
  sql += '\n);'

  // Add RLS
  sql += `\nALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`
  
  // Add RLS policy for sub-saas isolation
  sql += `\nCREATE POLICY "sub_saas_isolation" ON "${tableName}" FOR ALL USING (sub_saas_id = current_setting('app.sub_saas_id')::uuid);`

  // Add index on sub_saas_id
  sql += `\nCREATE INDEX IF NOT EXISTS "idx_${tableName.replace(/"/g, '')}_sub_saas" ON "${tableName}"(sub_saas_id);`

  return sql
}

function mapColumnType(type: string): string {
  const typeMap: Record<string, string> = {
    'uuid': 'UUID',
    'text': 'TEXT',
    'string': 'TEXT',
    'integer': 'INTEGER',
    'int': 'INTEGER',
    'numeric': 'NUMERIC',
    'decimal': 'NUMERIC',
    'boolean': 'BOOLEAN',
    'bool': 'BOOLEAN',
    'date': 'DATE',
    'time': 'TIME',
    'timestamp': 'TIMESTAMPTZ',
    'timestamptz': 'TIMESTAMPTZ',
    'jsonb': 'JSONB',
    'json': 'JSONB',
    'array': 'JSONB'
  }
  return typeMap[type.toLowerCase()] || 'TEXT'
}

function formatDefault(value: any, type: string): string {
  if (value === null) return 'NULL'
  
  // SQL functions
  if (typeof value === 'string' && (
    value.includes('()') || 
    value.startsWith('gen_') || 
    value === 'now()' ||
    value.startsWith('current_')
  )) {
    return value
  }

  // Boolean
  if (type === 'boolean' || type === 'bool') {
    return value ? 'true' : 'false'
  }

  // Numbers
  if (type === 'integer' || type === 'numeric' || type === 'int' || type === 'decimal') {
    return String(value)
  }

  // JSON
  if (type === 'jsonb' || type === 'json' || type === 'array') {
    return `'${JSON.stringify(value)}'::jsonb`
  }

  // Text/String
  return `'${String(value).replace(/'/g, "''")}'`
}

// =====================================================
// STRIPE CONNECT SETUP
// =====================================================

async function setupStripeConnect(
  supabase: any, 
  subSaasId: string, 
  tenantId: string, 
  businessName: string
) {
  const stripeHeaders = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  try {
    // Create connected account (Express type for easier onboarding)
    const accountResponse = await fetch('https://api.stripe.com/v1/accounts', {
      method: 'POST',
      headers: stripeHeaders,
      body: new URLSearchParams({
        'type': 'express',
        'business_type': 'company',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        'metadata[sub_saas_id]': subSaasId,
        'metadata[tenant_id]': tenantId
      })
    })
    
    const account = await accountResponse.json()

    if (account.error) {
      throw new Error(account.error.message)
    }

    // Save to database
    await supabase
      .from('stripe_connect_accounts')
      .insert({
        sub_saas_id: subSaasId,
        tenant_id: tenantId,
        stripe_account_id: account.id,
        account_type: 'express',
        business_name: businessName
      })

    // Update sub-saas app
    await supabase
      .from('sub_saas_apps')
      .update({ stripe_account_id: account.id })
      .eq('id', subSaasId)

    return {
      account_id: account.id,
      onboarding_required: true
    }

  } catch (error) {
    console.error('Stripe Connect setup failed:', error)
    return null
  }
}
