# Supabase SaaS Multi-Tenant Infrastructure - LLM Instructions

## Overview

You are interacting with a Supabase-based multi-tenant SaaS infrastructure. This system provides programmatic control over databases, Edge Functions, secrets, cron jobs, encrypted vaults, domains, tenants, and team management.

**Base URL:** `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1`

---

## Authentication

All requests require these headers:

```
apikey: <LEGACY_ANON_JWT_KEY>
Authorization: Bearer <LEGACY_ANON_JWT_KEY>
Content-Type: application/json
```

Admin functions additionally require:
```
X-Admin-Key: <ADMIN_KEY>
```

### Key Types

| Key | Purpose | Required For |
|:----|:--------|:-------------|
| `LEGACY_ANON_JWT_KEY` | Supabase auth (starts with `eyJ...`) | All requests |
| `ADMIN_KEY` | Admin operations | manage-database, manage-functions, manage-secrets, manage-cron, manage-vault, mcp-server |
| `Authorization: Bearer <user_jwt>` | User-specific operations | provision-tenant, invite-team-member, manage-domain |

---

## MCP Server Endpoint

**Unified endpoint for all tools:**

```
POST https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/mcp-server
```

### Simple Format (Recommended for LLMs)

```json
{
  "tool": "<tool_name>",
  "action": "<action>",
  ...additional_parameters
}
```

### MCP Protocol Format

```json
{
  "name": "<tool_name>",
  "arguments": {
    "action": "<action>",
    ...additional_parameters
  }
}
```

### Available Endpoints

| Method | Path | Purpose |
|:-------|:-----|:--------|
| GET | `/mcp-server` | Welcome + documentation |
| GET | `/mcp-server/info` | Server capabilities |
| GET | `/mcp-server/tools` | List all available tools |
| POST | `/mcp-server/call` | Call tool (MCP format) |
| POST | `/mcp-server` | Call tool (simple format) |

---

## Tool Reference

### 1. manage_database

Full database schema management.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list_tables` | List all tables with metadata | - |
| `describe` | Get table schema details | `table_name` |
| `create_table` | Create new table | `table_name`, `columns` |
| `add_column` | Add column to table | `table_name`, `columns` |
| `create_index` | Create index | `table_name`, `columns`, `index_name` |
| `run_sql` | Execute raw SQL | `sql` |
| `drop_table` | Delete table | `table_name` |

#### Examples

**List all tables:**
```json
{"tool": "manage_database", "action": "list_tables"}
```

**Describe a table:**
```json
{"tool": "manage_database", "action": "describe", "table_name": "users"}
```

**Create a table:**
```json
{
  "tool": "manage_database",
  "action": "create_table",
  "table_name": "products",
  "columns": [
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "name", "type": "text", "nullable": false},
    {"name": "price", "type": "decimal(10,2)"},
    {"name": "tenant_id", "type": "uuid", "references": "tenants(id)"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
  ],
  "enable_rls": true,
  "tenant_isolated": true
}
```

**Add column:**
```json
{
  "tool": "manage_database",
  "action": "add_column",
  "table_name": "products",
  "columns": [
    {"name": "description", "type": "text"},
    {"name": "is_active", "type": "boolean", "default": "true"}
  ]
}
```

**Run custom SQL:**
```json
{
  "tool": "manage_database",
  "action": "run_sql",
  "sql": "SELECT COUNT(*) FROM tenants WHERE plan = 'pro'"
}
```

---

### 2. manage_functions

Edge Function lifecycle management.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list` | List all functions | - |
| `get` | Get function details | `function_name` |
| `create` | Deploy new function | `function_name`, `function_code` |
| `update` | Update function code | `function_name`, `function_code` |
| `delete` | Remove function | `function_name` |

#### Examples

**List all functions:**
```json
{"tool": "manage_functions", "action": "list"}
```

**Get function details:**
```json
{"tool": "manage_functions", "action": "get", "function_name": "provision-tenant"}
```

**Create new function:**
```json
{
  "tool": "manage_functions",
  "action": "create",
  "function_name": "hello-world",
  "function_code": "import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'\n\nserve((req) => new Response('Hello World!'))",
  "verify_jwt": false
}
```

**Update function:**
```json
{
  "tool": "manage_functions",
  "action": "update",
  "function_name": "hello-world",
  "function_code": "<new code here>"
}
```

**Delete function:**
```json
{"tool": "manage_functions", "action": "delete", "function_name": "hello-world"}
```

---

### 3. manage_secrets

Edge Function environment secrets.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list` | List secret names (not values) | - |
| `set` | Create/update secrets | `secrets` array |
| `delete` | Remove secrets | `secrets` array of names |

#### Examples

**List secrets:**
```json
{"tool": "manage_secrets", "action": "list"}
```

**Set secrets:**
```json
{
  "tool": "manage_secrets",
  "action": "set",
  "secrets": [
    {"name": "OPENAI_API_KEY", "value": "sk-..."},
    {"name": "WEBHOOK_SECRET", "value": "whsec_..."}
  ]
}
```

**Delete secrets:**
```json
{
  "tool": "manage_secrets",
  "action": "delete",
  "secrets": ["OPENAI_API_KEY", "WEBHOOK_SECRET"]
}
```

---

### 4. manage_cron

Scheduled job management using pg_cron.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list` | List all cron jobs | - |
| `get` | Get job details | `job_name` |
| `create` | Create scheduled job | `job_name`, `schedule`, `command` |
| `update` | Modify job | `job_name`, + fields to update |
| `delete` | Remove job | `job_name` |
| `run_now` | Execute immediately | `job_name` |
| `history` | Get execution history | `job_name` (optional) |

#### Cron Schedule Format

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-7, Sun=0 or 7)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)
```

#### Examples

**List jobs:**
```json
{"tool": "manage_cron", "action": "list"}
```

**Create daily cleanup job:**
```json
{
  "tool": "manage_cron",
  "action": "create",
  "job_name": "daily-cleanup",
  "schedule": "0 3 * * *",
  "command": "SELECT cleanup_old_logs()",
  "description": "Clean logs older than 30 days at 3 AM daily"
}
```

**Create hourly sync:**
```json
{
  "tool": "manage_cron",
  "action": "create",
  "job_name": "hourly-sync",
  "schedule": "0 * * * *",
  "command": "SELECT sync_external_data()"
}
```

**Run job immediately:**
```json
{"tool": "manage_cron", "action": "run_now", "job_name": "daily-cleanup"}
```

**View execution history:**
```json
{"tool": "manage_cron", "action": "history", "job_name": "daily-cleanup"}
```

---

### 5. manage_vault

Encrypted tenant-scoped secrets using Supabase Vault.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list` | List vault secrets | - |
| `get` | Retrieve secret value | `secret_name` |
| `create` | Store new secret | `secret_name`, `secret_value` |
| `update` | Update secret | `secret_name`, `secret_value` |
| `delete` | Remove secret | `secret_name` |

#### Scopes

| Scope | Visible To |
|:------|:-----------|
| `global` | All tenants |
| `tenant` | Current tenant only |
| `user` | Current user only |

#### Examples

**List secrets:**
```json
{"tool": "manage_vault", "action": "list"}
```

**Store tenant API key:**
```json
{
  "tool": "manage_vault",
  "action": "create",
  "secret_name": "stripe_api_key",
  "secret_value": "sk_live_...",
  "scope": "tenant",
  "description": "Stripe API key for billing"
}
```

**Retrieve secret:**
```json
{"tool": "manage_vault", "action": "get", "secret_name": "stripe_api_key"}
```

---

### 6. manage_domain

Custom email domain management via Resend.

#### Actions

| Action | Description | Required Params |
|:-------|:------------|:----------------|
| `list` | List domains | - |
| `add` | Add new domain | `domain` |
| `verify` | Check DNS verification | `domain_id` |
| `set_primary` | Set as default domain | `domain_id` |
| `update_email` | Update from address | `domain_id`, `email_from_name`, `email_from_address` |
| `delete` | Remove domain | `domain_id` |

#### Examples

**List domains:**
```json
{"tool": "manage_domain", "action": "list"}
```

**Add domain:**
```json
{"tool": "manage_domain", "action": "add", "domain": "mycompany.com"}
```

**Verify DNS:**
```json
{"tool": "manage_domain", "action": "verify", "domain_id": "uuid-here"}
```

**Set email from address:**
```json
{
  "tool": "manage_domain",
  "action": "update_email",
  "domain_id": "uuid-here",
  "email_from_name": "Acme Support",
  "email_from_address": "support@mycompany.com"
}
```

---

### 7. provision_tenant

Create new tenant/organization.

#### Parameters

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `name` | string | Yes | Tenant name |
| `plan` | string | No | `free`, `starter`, `pro`, `enterprise` |

#### Example

```json
{
  "tool": "provision_tenant",
  "name": "Acme Corporation",
  "plan": "pro"
}
```

---

### 8. invite_team_member

Send team invitation email.

#### Parameters

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `email` | string | Yes | Invitee email |
| `role` | string | Yes | `admin`, `member`, `viewer` |
| `message` | string | No | Personal message |

#### Example

```json
{
  "tool": "invite_team_member",
  "email": "jane@example.com",
  "role": "admin",
  "message": "Welcome to our team!"
}
```

---

### 9. discover_services

List available microservices.

#### Parameters

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `category` | string | No | Filter by category |
| `enabled_only` | boolean | No | Only show enabled |

#### Example

```json
{"tool": "discover_services", "enabled_only": true}
```

---

### 10. check_service_health

Check health status of services.

#### Parameters

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `service_id` | string | No | Specific service (or all) |

#### Example

```json
{"tool": "check_service_health", "service_id": "payment-service"}
```

---

## Direct Edge Function Endpoints

If not using MCP, call functions directly:

| Function | Endpoint | Auth |
|:---------|:---------|:-----|
| manage-database | `/manage-database` | Admin |
| manage-functions | `/manage-functions` | Admin |
| manage-secrets | `/manage-secrets` | Admin |
| manage-cron | `/manage-cron` | Admin |
| manage-vault | `/manage-vault` | Admin |
| manage-domain | `/manage-domain` | User |
| provision-tenant | `/provision-tenant` | User |
| invite-team-member | `/invite-team-member` | User |
| accept-invite | `/accept-invite` | User |
| discover-services | `/discover-services` | User |
| check-service-health | `/check-service-health` | User |
| configure-service | `/configure-service` | User |
| create-api-key | `/create-api-key` | User |
| validate-api-key | `/validate-api-key` | Public |
| create-checkout | `/create-checkout` | User |
| customer-portal | `/customer-portal` | User |
| stripe-webhook | `/stripe-webhook` | Public (signed) |
| check-usage-limits | `/check-usage-limits` | User |
| track-usage | `/track-usage` | User |
| log-activity | `/log-activity` | User |
| deploy-page | `/deploy-page` | User |
| setup-page | `/setup-page` | User |

---

## Request Template

### Admin Request (manage-*)

```http
POST https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/mcp-server
Content-Type: application/json
apikey: <LEGACY_ANON_JWT_KEY>
Authorization: Bearer <LEGACY_ANON_JWT_KEY>
X-Admin-Key: <ADMIN_KEY>

{"tool": "manage_database", "action": "list_tables"}
```

### User Request

```http
POST https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/mcp-server
Content-Type: application/json
apikey: <LEGACY_ANON_JWT_KEY>
Authorization: Bearer <USER_JWT_TOKEN>

{"tool": "provision_tenant", "name": "My Company", "plan": "starter"}
```

---

## Common Workflows

### 1. Set Up New Tenant

```json
// Step 1: Create tenant
{"tool": "provision_tenant", "name": "Acme Corp", "plan": "pro"}

// Step 2: Add custom domain
{"tool": "manage_domain", "action": "add", "domain": "acme.com"}

// Step 3: Verify domain DNS
{"tool": "manage_domain", "action": "verify", "domain_id": "<uuid>"}

// Step 4: Invite team members
{"tool": "invite_team_member", "email": "cto@acme.com", "role": "admin"}
```

### 2. Add New Feature Table

```json
// Step 1: Create table
{
  "tool": "manage_database",
  "action": "create_table",
  "table_name": "feature_flags",
  "columns": [
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "tenant_id", "type": "uuid", "references": "tenants(id)"},
    {"name": "flag_name", "type": "text", "nullable": false},
    {"name": "enabled", "type": "boolean", "default": "false"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
  ],
  "enable_rls": true,
  "tenant_isolated": true
}

// Step 2: Add index
{
  "tool": "manage_database",
  "action": "create_index",
  "table_name": "feature_flags",
  "columns": ["tenant_id", "flag_name"],
  "index_name": "idx_feature_flags_tenant_name"
}
```

### 3. Deploy New Microservice

```json
// Step 1: Create function
{
  "tool": "manage_functions",
  "action": "create",
  "function_name": "process-webhooks",
  "function_code": "...",
  "verify_jwt": false
}

// Step 2: Add required secrets
{
  "tool": "manage_secrets",
  "action": "set",
  "secrets": [{"name": "WEBHOOK_SECRET", "value": "..."}]
}

// Step 3: Schedule cleanup job
{
  "tool": "manage_cron",
  "action": "create",
  "job_name": "cleanup-processed-webhooks",
  "schedule": "0 4 * * *",
  "command": "DELETE FROM webhook_logs WHERE processed_at < NOW() - INTERVAL '7 days'"
}
```

---

## Error Handling

| HTTP Code | Meaning | Action |
|:----------|:--------|:-------|
| 200 | Success | Parse response |
| 400 | Bad request | Check parameters |
| 401 | Unauthorized | Check API keys |
| 403 | Forbidden | Check ADMIN_KEY or permissions |
| 404 | Not found | Check resource exists |
| 500 | Server error | Check function logs |

---

## Tips for LLMs

1. **Always use the MCP endpoint** (`/mcp-server`) for unified access
2. **Use simple format** (`{"tool": "...", ...}`) over MCP protocol format
3. **List before modifying** - always `list` or `describe` before `update` or `delete`
4. **Enable RLS** on new tables with `"enable_rls": true`
5. **Use tenant isolation** for multi-tenant tables with `"tenant_isolated": true`
6. **Check secrets exist** before deploying functions that need them
7. **Validate domains** after adding - DNS propagation takes time
