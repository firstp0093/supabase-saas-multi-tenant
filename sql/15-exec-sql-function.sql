-- =====================================================
-- EXEC_SQL FUNCTION
-- Allows Edge Functions to execute dynamic SQL
-- Required for creating sub-saas tables from templates
-- =====================================================

-- Create the function with SECURITY DEFINER to run with elevated privileges
CREATE OR REPLACE FUNCTION public.exec_sql(sql TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Security: Only allow certain SQL operations
    -- This prevents arbitrary SQL execution while allowing table management
    
    -- Check if it's an allowed operation
    IF NOT (
        sql ~* '^\s*(CREATE|ALTER|DROP)\s+TABLE' OR
        sql ~* '^\s*CREATE\s+(UNIQUE\s+)?INDEX' OR
        sql ~* '^\s*ALTER\s+TABLE.*ENABLE\s+ROW\s+LEVEL\s+SECURITY' OR
        sql ~* '^\s*CREATE\s+POLICY' OR
        sql ~* '^\s*DROP\s+POLICY' OR
        sql ~* '^\s*GRANT' OR
        sql ~* '^\s*COMMENT\s+ON'
    ) THEN
        RAISE EXCEPTION 'Only DDL statements for tables, indexes, policies, and grants are allowed';
    END IF;
    
    -- Additional security: Only allow operations on sub-saas tables (prefixed with ss_)
    -- or explicitly allowed system operations
    IF sql ~* '(CREATE|ALTER|DROP)\s+TABLE' AND NOT sql ~* '"?ss_[a-z0-9_]+' THEN
        RAISE EXCEPTION 'Table operations are only allowed on sub-saas tables (ss_* prefix)';
    END IF;
    
    -- Execute the SQL
    EXECUTE sql;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'SQL executed successfully'
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$$;

-- Only allow service role to execute this function
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM authenticated;
-- Service role will have access through SECURITY DEFINER

-- =====================================================
-- HELPER: Drop all tables for a sub-saas (cleanup)
-- =====================================================

CREATE OR REPLACE FUNCTION public.drop_sub_saas_tables(sub_saas_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    table_record RECORD;
    dropped_tables TEXT[] := ARRAY[]::TEXT[];
    prefix TEXT;
BEGIN
    prefix := 'ss_' || replace(sub_saas_uuid::TEXT, '-', '_');
    
    -- Find and drop all tables with this prefix
    FOR table_record IN 
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename LIKE prefix || '%'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', table_record.tablename);
        dropped_tables := array_append(dropped_tables, table_record.tablename);
    END LOOP;
    
    -- Remove from sub_saas_tables tracking
    DELETE FROM public.sub_saas_tables WHERE sub_saas_id = sub_saas_uuid;
    
    RETURN jsonb_build_object(
        'success', true,
        'dropped_tables', to_jsonb(dropped_tables)
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;

-- =====================================================
-- HELPER: List tables for a sub-saas
-- =====================================================

CREATE OR REPLACE FUNCTION public.list_sub_saas_tables(sub_saas_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    prefix TEXT;
    result JSONB;
BEGIN
    prefix := 'ss_' || replace(sub_saas_uuid::TEXT, '-', '_');
    
    SELECT jsonb_agg(jsonb_build_object(
        'table_name', t.tablename,
        'display_name', COALESCE(st.display_name, t.tablename),
        'row_count', (
            SELECT reltuples::BIGINT 
            FROM pg_class 
            WHERE relname = t.tablename
        )
    ))
    INTO result
    FROM pg_tables t
    LEFT JOIN public.sub_saas_tables st ON st.table_name = t.tablename
    WHERE t.schemaname = 'public' 
    AND t.tablename LIKE prefix || '%';
    
    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- =====================================================
-- HELPER: Set sub_saas_id context for RLS
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_sub_saas_context(sub_saas_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM set_config('app.sub_saas_id', sub_saas_uuid::TEXT, false);
END;
$$;

-- Allow authenticated users to set context
GRANT EXECUTE ON FUNCTION public.set_sub_saas_context(UUID) TO authenticated;

-- =====================================================
-- HELPER: Add column to existing sub-saas table
-- =====================================================

CREATE OR REPLACE FUNCTION public.add_sub_saas_column(
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_type TEXT,
    p_default_value TEXT DEFAULT NULL,
    p_required BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    sql TEXT;
BEGIN
    -- Verify it's a sub-saas table
    IF NOT p_table_name LIKE 'ss_%' THEN
        RAISE EXCEPTION 'Can only modify sub-saas tables (ss_* prefix)';
    END IF;
    
    sql := format('ALTER TABLE %I ADD COLUMN %I %s', 
        p_table_name, p_column_name, p_column_type);
    
    IF p_default_value IS NOT NULL THEN
        sql := sql || format(' DEFAULT %s', p_default_value);
    END IF;
    
    IF p_required THEN
        sql := sql || ' NOT NULL';
    END IF;
    
    EXECUTE sql;
    
    RETURN jsonb_build_object(
        'success', true,
        'table', p_table_name,
        'column', p_column_name
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
