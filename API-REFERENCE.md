# API Reference

All endpoints are at `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/`

## Authentication

Most endpoints require a Bearer token:
```
Authorization: Bearer <supabase_access_token>
```

Some endpoints also support API keys:
```
X-API-Key: pk_your-tenant_xxxx...
```

---

## Tenant & Team Management

### POST /provision-tenant
Create a new tenant with Stripe customer.

```json
// Request
{
  "tenant_name": "Acme Corp",
  "slug": "acme-corp"
}

// Response
{
  "tenant": { "id": "uuid", "name": "Acme Corp", "slug": "acme-corp" },
  "stripe_customer_id": "cus_xxx",
  "user_tenant": { "role": "owner" }
}
```

### POST /invite-team-member
Invite a user to your tenant.

```json
// Request
{
  "email": "john@example.com",
  "role": "member"  // admin, member, viewer
}

// Response
{
  "success": true,
  "invite_id": "uuid",
  "invite_url": "https://app.com/invite/token123",
  "expires_at": "2026-01-27T12:00:00Z"
}
```

### POST /accept-invite
Accept a team invitation.

```json
// Request
{
  "token": "invite-token-from-url"
}

// Response
{
  "success": true,
  "membership_id": "uuid",
  "tenant": { "name": "Acme Corp", "slug": "acme-corp" },
  "role": "member"
}
```

---

## Billing & Usage

### POST /create-checkout
Create Stripe checkout session.

```json
// Request
{
  "price_id": "price_xxx",
  "mode": "subscription",  // or "payment"
  "success_url": "https://app.com/success",
  "cancel_url": "https://app.com/pricing"
}

// Response
{
  "url": "https://checkout.stripe.com/..."
}
```

### POST /customer-portal
Open Stripe customer portal.

```json
// Request
{
  "return_url": "https://app.com/settings"
}

// Response
{
  "url": "https://billing.stripe.com/..."
}
```

### POST /check-usage-limits
Check if an action is allowed by plan limits.

```json
// Request
{
  "feature": "pages",    // pages, deployments, team_members, api_calls
  "quantity": 1
}

// Response
{
  "allowed": true,
  "feature": "pages",
  "current": 2,
  "limit": 10,
  "remaining": 8,
  "period": "total",
  "plan": "starter",
  "upgrade_required": false
}
```

### POST /track-usage
Record a usage event.

```json
// Request
{
  "feature": "deployments",
  "quantity": 1,
  "metadata": { "page_id": "xxx" }
}

// Response
{
  "success": true,
  "feature": "deployments",
  "quantity": 1,
  "recorded_at": "2026-01-20T12:00:00Z"
}
```

---

## Page Deployment

### POST /setup-page
Get injectable HTML snippets for a page.

```json
// Request
{
  "page_id": "page-123",
  "environment": "test",  // or "production"
  "features": {
    "auth": true,
    "stripe": true,
    "gads_matching": true
  },
  "gads_config": {
    "keywords": {
      "cheap": { "headline": "Affordable Pricing" },
      "enterprise": { "headline": "Enterprise Solution" }
    },
    "default": { "headline": "Welcome" }
  }
}

// Response
{
  "snippets": {
    "head": "<script src=\"...\"></script>",
    "auth_init": "<script>...</script>",
    "auth_form": "<div>...</div>",
    "stripe_init": "<script>...</script>",
    "stripe_button": "<button>...</button>",
    "gads_init": "<script>...</script>"
  }
}
```

### POST /deploy-page
Deploy page to Cloudflare Pages.

```json
// Request
{
  "page_id": "page-123",
  "project_name": "my-landing"  // optional
}

// Response
{
  "success": true,
  "url": "https://my-landing.pages.dev",
  "preview_url": "https://abc123.my-landing.pages.dev",
  "deployment_id": "xxx"
}
```

### POST /gads-message-match
Get dynamic content based on ad keyword.

```json
// Request
{
  "page_id": "page-123",
  "keyword": "cheap",
  "gclid": "xxx"
}

// Response
{
  "matched": true,
  "replacements": {
    "headline": "Affordable Pricing",
    "cta": "Save 50% Today"
  }
}
```

---

## Service Discovery

### GET /discover-services
List all available services with status.

```
GET /discover-services?category=payments&include_disabled=false
```

```json
// Response
{
  "services": [
    {
      "id": "stripe",
      "name": "Stripe Payments",
      "category": "payments",
      "status": "healthy",
      "is_core": false,
      "dependencies": [],
      "tenant_config": {
        "is_enabled": true,
        "is_configured": true,
        "credentials_set": true
      }
    }
  ],
  "by_category": { "payments": [...], "hosting": [...] },
  "configured": 5,
  "total": 13
}
```

### POST /configure-service
Enable or configure a service.

```json
// Request
{
  "service_id": "openai",
  "action": "enable"  // enable, disable, configure, mark_configured
}

// Response
{
  "success": true,
  "service_id": "openai",
  "action": "enable",
  "tenant_service": { ... }
}
```

### POST /check-service-health
Run health checks on all services.

```json
// Headers
X-Cron-Secret: your-cron-secret

// Response
{
  "checked_at": "2026-01-20T12:00:00Z",
  "summary": { "healthy": 12, "degraded": 1, "down": 0 },
  "results": [
    { "service_id": "stripe", "status": "healthy", "response_time_ms": 150 }
  ]
}
```

### POST /update-service-catalog
Admin: Add or update services.

```json
// Request
{
  "admin_key": "your-admin-key",
  "action": "add",  // add, update, deprecate, enable, disable, remove
  "service": {
    "id": "slack",
    "name": "Slack Notifications",
    "category": "communication",
    "description": "Send notifications to Slack"
  }
}
```

---

## API Keys

### POST /create-api-key
Generate a new API key.

```json
// Request
{
  "name": "Production Key",
  "scopes": ["read", "write", "deploy"],
  "expires_in_days": 90  // null = never
}

// Response
{
  "success": true,
  "api_key": {
    "id": "uuid",
    "name": "Production Key",
    "key": "pk_acme-corp_abc123...",  // ONLY SHOWN ONCE
    "key_prefix": "pk_acme-corp_abc1...",
    "scopes": ["read", "write", "deploy"],
    "expires_at": "2026-04-20T12:00:00Z"
  },
  "warning": "Save this key now. It cannot be retrieved again."
}
```

### POST /validate-api-key
Validate an API key and get tenant context.

```json
// Headers
X-API-Key: pk_acme-corp_abc123...

// Response
{
  "valid": true,
  "key_id": "uuid",
  "key_name": "Production Key",
  "scopes": ["read", "write", "deploy"],
  "tenant": {
    "id": "uuid",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "plan": "pro"
  }
}
```

---

## Activity Logging

### POST /log-activity
Record an audit event.

```json
// Request
{
  "action": "page.deployed",
  "resource_type": "page",
  "resource_id": "page-123",
  "metadata": { "environment": "production" }
}

// Response
{
  "success": true,
  "log_id": "uuid",
  "logged_at": "2026-01-20T12:00:00Z"
}
```

---

## Webhooks

### POST /stripe-webhook
Stripe webhook handler (called by Stripe).

Handles:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Updates `tenants.plan` based on subscription changes.

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message here",
  "code": "ERROR_CODE"  // optional
}
```

Common HTTP status codes:
- `400` - Bad request / validation error
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `500` - Internal server error
