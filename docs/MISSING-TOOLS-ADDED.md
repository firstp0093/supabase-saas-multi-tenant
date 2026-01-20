# Missing Tools - Now Added ✅

Based on your analysis, I've added 4 critical infrastructure management tools:

---

## 1. manage-billing ✅

**Purpose:** Stripe subscription & payment management

**Location:** `functions/manage-billing/index.ts`

**Actions:**

| Action | Description | Params |
|:-------|:------------|:-------|
| `get_status` | Get subscription status & plan | - |
| `change_plan` | Upgrade/downgrade subscription | `plan` |
| `cancel` | Cancel at period end | - |
| `reactivate` | Un-cancel subscription | - |
| `update_payment_method` | Change payment method | `payment_method_id` |
| `get_invoices` | List recent invoices | - |

**Examples:**

```json
// Check subscription status
{"tool": "manage_billing", "action": "get_status"}

// Upgrade to Pro
{"tool": "manage_billing", "action": "change_plan", "plan": "pro"}

// Get invoices
{"tool": "manage_billing", "action": "get_invoices"}
```

**Use Cases:**
- Check if payment failed
- Automatically upgrade tenant when usage exceeds plan
- Download invoices for accounting
- Handle subscription lifecycle

---

## 2. manage-rbac ✅

**Purpose:** Custom roles & permissions (beyond admin/member/viewer)

**Location:** `functions/manage-rbac/index.ts`

**Actions:**

| Action | Description | Params |
|:-------|:------------|:-------|
| `list_roles` | List all custom roles | - |
| `create_role` | Create new role | `role_name`, `permissions` |
| `update_role` | Update role permissions | `role_name`, `permissions` |
| `delete_role` | Remove custom role | `role_name` |
| `assign_role` | Assign role to user | `user_id`, `tenant_id`, `role_name` |
| `check_permission` | Get user permissions | `user_id`, `tenant_id` |

**Examples:**

```json
// Create "Manager" role
{
  "tool": "manage_rbac",
  "action": "create_role",
  "role_name": "manager",
  "permissions": [
    "read:reports",
    "write:content",
    "manage:team_members"
  ]
}

// Assign to user
{
  "tool": "manage_rbac",
  "action": "assign_role",
  "user_id": "uuid-here",
  "tenant_id": "uuid-here",
  "role_name": "manager"
}

// Check what user can do
{
  "tool": "manage_rbac",
  "action": "check_permission",
  "user_id": "uuid-here",
  "tenant_id": "uuid-here"
}
```

**Use Cases:**
- Create "Content Editor" role (can write but not publish)
- Create "Billing Admin" (can manage payments only)
- Check if user has `delete:tenant` permission
- Implement granular RLS policies based on custom roles

---

## 3. manage-config ✅

**Purpose:** Global settings & feature flags

**Location:** `functions/manage-config/index.ts`

**Actions:**

| Action | Description | Params |
|:-------|:------------|:-------|
| `get` | Get config value(s) | `key` (optional), `scope`, `tenant_id` |
| `set` | Set config value | `key`, `value`, `scope`, `tenant_id` |
| `delete` | Remove config | `key`, `scope`, `tenant_id` |
| `toggle_feature` | Enable/disable feature | `key`, `scope`, `tenant_id` |
| `maintenance_mode` | Enable/disable maintenance | `value` (true/false) |

**Scopes:**
- `global` - Affects all tenants
- `tenant` - Specific tenant only

**Examples:**

```json
// Enable maintenance mode
{
  "tool": "manage_config",
  "action": "maintenance_mode",
  "value": true
}

// Enable new feature globally
{
  "tool": "manage_config",
  "action": "set",
  "key": "ai_assistant_enabled",
  "value": true,
  "scope": "global"
}

// Toggle feature for specific tenant
{
  "tool": "manage_config",
  "action": "toggle_feature",
  "key": "advanced_analytics",
  "scope": "tenant",
  "tenant_id": "uuid-here"
}

// Get all config
{"tool": "manage_config", "action": "get"}
```

**Use Cases:**
- Put app in maintenance mode during deployments
- Enable beta features for specific tenants
- A/B test new UI by toggling `new_dashboard_ui`
- Set global rate limits: `{"key": "api_rate_limit", "value": 1000}`

---

## 4. get-analytics ✅

**Purpose:** Query usage, logs, and metrics

**Location:** `functions/get-analytics/index.ts`

**Report Types:**

| Type | Description | Params |
|:-----|:------------|:-------|
| `usage` | API usage by tenant/metric | `tenant_id`, `start_date`, `end_date` |
| `activity` | Activity log entries | `tenant_id`, `start_date`, `end_date`, `limit` |
| `api_requests` | API request logs + stats | `tenant_id`, `start_date`, `end_date`, `limit` |
| `tenant_summary` | Per-tenant overview | `start_date`, `end_date` |
| `dashboard` | High-level metrics | - |

**Examples:**

```json
// Get tenant API usage last 7 days
{
  "tool": "get_analytics",
  "report_type": "usage",
  "tenant_id": "uuid-here",
  "start_date": "2026-01-13T00:00:00Z"
}

// Dashboard metrics
{
  "tool": "get_analytics",
  "report_type": "dashboard"
}

// Recent activity
{
  "tool": "get_analytics",
  "report_type": "activity",
  "limit": 50
}

// API request stats
{
  "tool": "get_analytics",
  "report_type": "api_requests",
  "start_date": "2026-01-20T00:00:00Z",
  "end_date": "2026-01-20T23:59:59Z"
}
```

**Use Cases:**
- Check if tenant is approaching usage limits
- Generate invoice data for overage charges
- Debug failed API requests
- Audit who deleted what and when
- Display usage graphs in admin dashboard

---

## Required Database Tables

You'll need to create these tables:

```sql
-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add role column to tenant_users
ALTER TABLE tenant_users ADD COLUMN role TEXT DEFAULT 'member';

-- Global config table
CREATE TABLE global_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  scope TEXT DEFAULT 'global', -- 'global' or 'tenant'
  tenant_id UUID REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key, scope, tenant_id)
);

ALTER TABLE global_config ENABLE ROW LEVEL SECURITY;
```

---

## Deploy Instructions

1. **Run SQL migrations** (create tables above) in SQL Editor

2. **Deploy 4 new functions:**
   - `manage-billing`
   - `manage-rbac`
   - `manage-config`
   - `get-analytics`

3. **Add Stripe keys** to Edge Secrets:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_STARTER`
   - `STRIPE_PRICE_PRO`
   - `STRIPE_PRICE_ENTERPRISE`

4. **Update MCP server** to include new tools (see below)

---

## Updated MCP Tool List

Your MCP server now supports **14 tools**:

### Infrastructure (Admin)
1. `manage_database`
2. `manage_functions`
3. `manage_secrets`
4. `manage_cron`
5. `manage_vault`
6. `manage_rbac` ✨ NEW
7. `manage_config` ✨ NEW
8. `get_analytics` ✨ NEW

### Business Logic (User)
9. `manage_billing` ✨ NEW
10. `manage_domain`
11. `provision_tenant`
12. `invite_team_member`
13. `discover_services`
14. `check_service_health`

---

## Example Workflows

### Auto-upgrade tenant when hitting limits

```json
// 1. Check usage
{
  "tool": "get_analytics",
  "report_type": "usage",
  "tenant_id": "abc-123"
}

// 2. If over limit, upgrade
{
  "tool": "manage_billing",
  "action": "change_plan",
  "plan": "pro"
}
```

### Create custom "Content Manager" role

```json
// 1. Create role
{
  "tool": "manage_rbac",
  "action": "create_role",
  "role_name": "content_manager",
  "permissions": ["read:all", "write:content", "publish:content"]
}

// 2. Assign to user
{
  "tool": "manage_rbac",
  "action": "assign_role",
  "user_id": "user-uuid",
  "tenant_id": "tenant-uuid",
  "role_name": "content_manager"
}
```

### Enable beta feature for one tenant

```json
{
  "tool": "manage_config",
  "action": "set",
  "key": "beta_ai_copilot",
  "value": true,
  "scope": "tenant",
  "tenant_id": "early-adopter-uuid"
}
```

### Generate billing report

```json
// 1. Get usage data
{
  "tool": "get_analytics",
  "report_type": "usage",
  "start_date": "2026-01-01T00:00:00Z",
  "end_date": "2026-01-31T23:59:59Z"
}

// 2. Get invoices
{
  "tool": "manage_billing",
  "action": "get_invoices"
}
```

---

## Summary

You now have **complete infrastructure control** through the MCP:

✅ **Billing** - Manage subscriptions, payments, invoices  
✅ **RBAC** - Custom roles beyond admin/member/viewer  
✅ **Config** - Global settings, feature flags, maintenance mode  
✅ **Analytics** - Query usage, logs, metrics, generate reports  

All gaps identified have been filled!
