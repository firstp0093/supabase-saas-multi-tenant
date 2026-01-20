// =====================================================
// MANAGE DATABASE SCHEMA
// Create tables, add columns, run migrations
// For AI-driven infrastructure management
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
  
  // Require admin key
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
  
  const { action, table_name, columns, sql, migration_name, enable_rls, tenant_isolated } = await req.json()
  
  // ===== LIST TABLES =====
  if (action === 'list_tables') {
    try {
      const { data, error } = await supabase.rpc('get_tables_info')
      
      // If RPC doesn't exist, use raw query
      if (error) {
        const { data: tables, error: queryError } = await supabase
          .from('information_schema.tables')
          .select('table_name, table_type')
          .eq('table_schema', 'public')
        
        if (queryError) {
          // Fallback: direct SQL
          const result = await executeSql(supabase, `
            SELECT table_name, 
                   (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
            FROM information_schema.tables t
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
          `)
          return new Response(JSON.stringify({ success: true, tables: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        
        return new Response(JSON.stringify({ success: true, tables }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      return new Response(JSON.stringify({ success: true, tables: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DESCRIBE TABLE =====
  if (action === 'describe') {
    if (!table_name) {
      return new Response(JSON.stringify({ error: 'table_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const result = await executeSql(supabase, `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table_name}'
        ORDER BY ordinal_position
      `)
      
      // Get indexes
      const indexes = await executeSql(supabase, `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = '${table_name}'
      `)
      
      // Check RLS status
      const rlsStatus = await executeSql(supabase, `
        SELECT relrowsecurity 
        FROM pg_class 
        WHERE relname = '${table_name}' AND relnamespace = 'public'::regnamespace
      `)
      
      return new Response(JSON.stringify({
        success: true,
        table: table_name,
        columns: result,
        indexes,
        rls_enabled: rlsStatus?.[0]?.relrowsecurity || false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== CREATE TABLE =====
  if (action === 'create_table') {
    if (!table_name || !columns || !Array.isArray(columns)) {
      return new Response(JSON.stringify({ 
        error: 'table_name and columns array required',
        example: {
          table_name: 'my_table',
          columns: [
            { name: 'id', type: 'UUID', primary: true, default: 'gen_random_uuid()' },
            { name: 'tenant_id', type: 'UUID', references: 'tenants(id)', on_delete: 'CASCADE' },
            { name: 'name', type: 'TEXT', nullable: false },
            { name: 'created_at', type: 'TIMESTAMPTZ', default: 'now()' }
          ],
          enable_rls: true,
          tenant_isolated: true
        }
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Validate table name
    if (!/^[a-z_][a-z0-9_]*$/.test(table_name)) {
      return new Response(JSON.stringify({ error: 'Invalid table name. Use lowercase with underscores.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Build CREATE TABLE statement
      const columnDefs = columns.map((col: any) => {
        let def = `${col.name} ${col.type}`
        if (col.primary) def += ' PRIMARY KEY'
        if (col.nullable === false) def += ' NOT NULL'
        if (col.unique) def += ' UNIQUE'
        if (col.default) def += ` DEFAULT ${col.default}`
        if (col.references) def += ` REFERENCES public.${col.references}`
        if (col.on_delete) def += ` ON DELETE ${col.on_delete}`
        if (col.check) def += ` CHECK (${col.check})`
        return def
      }).join(',\n  ')
      
      const createSql = `CREATE TABLE public.${table_name} (\n  ${columnDefs}\n);`
      
      await executeSql(supabase, createSql)
      
      // Enable RLS if requested
      if (enable_rls !== false) {
        await executeSql(supabase, `ALTER TABLE public.${table_name} ENABLE ROW LEVEL SECURITY;`)
      }
      
      // Add tenant isolation policy if requested
      if (tenant_isolated && columns.some((c: any) => c.name === 'tenant_id')) {
        await executeSql(supabase, `
          CREATE POLICY "Tenant isolation" ON public.${table_name}
            FOR ALL USING (tenant_id = public.get_current_tenant_id());
        `)
      }
      
      // Create index on tenant_id if present
      if (columns.some((c: any) => c.name === 'tenant_id')) {
        await executeSql(supabase, `CREATE INDEX idx_${table_name}_tenant ON public.${table_name}(tenant_id);`)
      }
      
      // Log the migration
      await supabase.from('activity_log').insert({
        action: 'database.table_created',
        resource_type: 'database_table',
        resource_id: table_name,
        metadata: { columns: columns.map((c: any) => c.name), enable_rls, tenant_isolated }
      })
      
      return new Response(JSON.stringify({
        success: true,
        table: table_name,
        sql: createSql,
        rls_enabled: enable_rls !== false,
        tenant_isolated: tenant_isolated || false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== ADD COLUMN =====
  if (action === 'add_column') {
    if (!table_name || !columns || !Array.isArray(columns)) {
      return new Response(JSON.stringify({ 
        error: 'table_name and columns array required',
        example: {
          table_name: 'my_table',
          columns: [
            { name: 'new_field', type: 'TEXT', nullable: true, default: "''" }
          ]
        }
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const results = []
      
      for (const col of columns) {
        let alterSql = `ALTER TABLE public.${table_name} ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        if (col.nullable === false) alterSql += ' NOT NULL'
        if (col.default) alterSql += ` DEFAULT ${col.default}`
        if (col.references) alterSql += ` REFERENCES public.${col.references}`
        alterSql += ';'
        
        await executeSql(supabase, alterSql)
        results.push({ column: col.name, sql: alterSql })
      }
      
      // Log
      await supabase.from('activity_log').insert({
        action: 'database.columns_added',
        resource_type: 'database_table',
        resource_id: table_name,
        metadata: { columns: columns.map((c: any) => c.name) }
      })
      
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== CREATE INDEX =====
  if (action === 'create_index') {
    const { index_name, column_names, unique } = await req.json()
    
    if (!table_name || !column_names) {
      return new Response(JSON.stringify({ error: 'table_name and column_names required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const cols = Array.isArray(column_names) ? column_names.join(', ') : column_names
      const idxName = index_name || `idx_${table_name}_${cols.replace(/,\s*/g, '_')}`
      const uniqueStr = unique ? 'UNIQUE ' : ''
      
      const indexSql = `CREATE ${uniqueStr}INDEX IF NOT EXISTS ${idxName} ON public.${table_name}(${cols});`
      await executeSql(supabase, indexSql)
      
      return new Response(JSON.stringify({ success: true, index: idxName, sql: indexSql }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== RUN RAW SQL =====
  if (action === 'run_sql') {
    if (!sql) {
      return new Response(JSON.stringify({ error: 'sql required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Block dangerous operations
    const dangerous = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE', 'DROP TABLE tenants', 'DROP TABLE user_tenants']
    const sqlUpper = sql.toUpperCase()
    if (dangerous.some(d => sqlUpper.includes(d))) {
      return new Response(JSON.stringify({ error: 'Operation not allowed' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const result = await executeSql(supabase, sql)
      
      // Log if it's a DDL operation
      if (sqlUpper.includes('CREATE') || sqlUpper.includes('ALTER') || sqlUpper.includes('DROP')) {
        await supabase.from('activity_log').insert({
          action: 'database.sql_executed',
          resource_type: 'database',
          metadata: { sql: sql.substring(0, 500), migration_name }
        })
      }
      
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message, sql }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DROP TABLE =====
  if (action === 'drop_table') {
    if (!table_name) {
      return new Response(JSON.stringify({ error: 'table_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Protect core tables
    const protectedTables = ['tenants', 'user_tenants', 'users', 'profiles', 'activity_log']
    if (protectedTables.includes(table_name)) {
      return new Response(JSON.stringify({ error: `Cannot drop protected table: ${table_name}` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      await executeSql(supabase, `DROP TABLE IF EXISTS public.${table_name} CASCADE;`)
      
      await supabase.from('activity_log').insert({
        action: 'database.table_dropped',
        resource_type: 'database_table',
        metadata: { table_name }
      })
      
      return new Response(JSON.stringify({ success: true, dropped: table_name }), {
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
    available: ['list_tables', 'describe', 'create_table', 'add_column', 'create_index', 'run_sql', 'drop_table']
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})

// Helper to execute raw SQL
async function executeSql(supabase: any, sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { query: sql })
  
  if (error) {
    // Try alternative method using postgres connection
    // This requires the exec_sql function to exist
    throw new Error(`SQL Error: ${error.message}. You may need to create the exec_sql function.`)
  }
  
  return data
}
