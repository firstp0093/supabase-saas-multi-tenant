# Getting Started Guide

This guide walks you through every user scenario - from first signup to advanced features.

## Table of Contents
1. [Quick Start (5 minutes)](#quick-start)
2. [User Scenarios](#user-scenarios)
3. [Frontend Integration](#frontend-integration)
4. [Testing Your Setup](#testing-your-setup)
5. [Common Workflows](#common-workflows)

---

## Quick Start

### What You Need
- Supabase project with Edge Functions deployed
- Frontend app (React, Vue, Next.js, etc.)
- Supabase JS client installed

### Your API Base URL
```
https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/
```

### Install Supabase Client
```bash
npm install @supabase/supabase-js
```

### Initialize Client
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://azgdvzilnusiaqxiyfce.supabase.co',
  'YOUR_ANON_KEY'  // From Supabase dashboard > Settings > API
)
```

---

## User Scenarios

### Scenario 1: New User Signs Up

**What happens:**
1. User creates account with email/password
2. User creates their first tenant (organization)
3. User becomes "owner" of that tenant

```typescript
// Step 1: Sign up
const { data: authData, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'securepassword123'
})

// Step 2: Create tenant (after email confirmation)
const { data: session } = await supabase.auth.getSession()

const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/provision-tenant',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tenant_name: 'My Company',
      slug: 'my-company'
    })
  }
)

const result = await response.json()
// { tenant: { id: '...', name: 'My Company', slug: 'my-company' }, stripe_customer_id: 'cus_xxx' }
```

**What's created:**
- Auth user in Supabase
- Tenant record
- Stripe customer
- User-tenant link with role "owner"

---

### Scenario 2: Existing User Logs In

```typescript
// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'securepassword123'
})

// Get user's tenants
const { data: tenants } = await supabase
  .from('user_tenants')
  .select(`
    role,
    is_default,
    tenants (
      id, name, slug, plan
    )
  `)
  .eq('user_id', data.user.id)

// tenants = [{ role: 'owner', is_default: true, tenants: { id: '...', name: 'My Company', plan: 'free' } }]
```

---

### Scenario 3: Invite Team Member

**Who can do this:** Owners and Admins only

```typescript
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/invite-team-member',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'teammate@example.com',
      role: 'member'  // 'admin', 'member', or 'viewer'
    })
  }
)

const { invite_url, expires_at } = await response.json()
// Send invite_url to the teammate via email
```

---

### Scenario 4: Accept Team Invite

**User flow:**
1. User clicks invite link
2. User signs up or logs in
3. User accepts invite

```typescript
// User is on page: /invite/TOKEN123
const token = 'TOKEN123'  // from URL

// User must be logged in first
const { data: session } = await supabase.auth.getSession()

const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/accept-invite',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token })
  }
)

const { tenant, role } = await response.json()
// User is now a member of the tenant!
```

---

### Scenario 5: Switch Between Tenants

If a user belongs to multiple organizations:

```typescript
// Get all tenants
const { data: tenants } = await supabase
  .from('user_tenants')
  .select('tenant_id, role, tenants(name, slug)')
  .eq('user_id', userId)

// Switch default tenant
const newTenantId = 'uuid-of-other-tenant'

// Unset current default
await supabase
  .from('user_tenants')
  .update({ is_default: false })
  .eq('user_id', userId)
  .eq('is_default', true)

// Set new default
await supabase
  .from('user_tenants')
  .update({ is_default: true })
  .eq('user_id', userId)
  .eq('tenant_id', newTenantId)
```

---

### Scenario 6: Upgrade Subscription

```typescript
// Create checkout session
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/create-checkout',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      price_id: 'price_xxx',  // Your Stripe price ID
      success_url: 'https://yourapp.com/billing?success=true',
      cancel_url: 'https://yourapp.com/pricing'
    })
  }
)

const { url } = await response.json()
window.location.href = url  // Redirect to Stripe Checkout
```

---

### Scenario 7: Manage Billing

```typescript
// Open Stripe customer portal
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/customer-portal',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      return_url: 'https://yourapp.com/settings'
    })
  }
)

const { url } = await response.json()
window.location.href = url  // Redirect to Stripe Portal
```

---

### Scenario 8: Check Usage Before Action

```typescript
// Before creating a new page, check limit
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/check-usage-limits',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      feature: 'pages',
      quantity: 1
    })
  }
)

const { allowed, current, limit, remaining, upgrade_required } = await response.json()

if (!allowed) {
  // Show upgrade modal
  showUpgradeModal(`You've used ${current}/${limit} pages. Upgrade to create more.`)
} else {
  // Proceed with creating page
  createPage()
}
```

---

### Scenario 9: Create API Key

**For developers who want programmatic access:**

```typescript
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/create-api-key',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Production API Key',
      scopes: ['read', 'write'],
      expires_in_days: 90  // null for never
    })
  }
)

const { api_key } = await response.json()
console.log('Save this key:', api_key.key)  // pk_my-company_abc123...
// This is the ONLY time you'll see the full key!
```

---

### Scenario 10: Use API Key (Server-Side)

```typescript
// From your backend or scripts
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/check-usage-limits',
  {
    method: 'POST',
    headers: {
      'X-API-Key': 'pk_my-company_abc123...',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      feature: 'api_calls'
    })
  }
)
```

---

### Scenario 11: Deploy a Landing Page

```typescript
// Step 1: Create page in database
const { data: page } = await supabase
  .from('pages')
  .insert({
    name: 'Product Launch',
    slug: 'product-launch',
    html_content: '<html>...</html>',
    gads_config: {
      keywords: {
        'cheap': { headline: 'Affordable Pricing' },
        'enterprise': { headline: 'Enterprise Solution' }
      },
      default: { headline: 'Welcome' }
    }
  })
  .select()
  .single()

// Step 2: Deploy to Cloudflare
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/deploy-page',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      page_id: page.id
    })
  }
)

const { url, preview_url } = await response.json()
// url = 'https://product-launch.pages.dev'
```

---

### Scenario 12: View Available Services

```typescript
const response = await fetch(
  'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/discover-services',
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
)

const { services, by_category, configured, total } = await response.json()

// services = [
//   { id: 'stripe', name: 'Stripe Payments', status: 'healthy', tenant_config: { is_enabled: true } },
//   { id: 'openai', name: 'OpenAI', status: 'healthy', tenant_config: { is_enabled: false } },
//   ...
// ]
```

---

## Frontend Integration

### React Hook Example

```typescript
// hooks/useAuth.ts
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadTenant(session.user.id)
      else setLoading(false)
    })

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) loadTenant(session.user.id)
        else {
          setTenant(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function loadTenant(userId: string) {
    const { data } = await supabase
      .from('user_tenants')
      .select('role, tenants(*)')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single()
    
    setTenant(data?.tenants ?? null)
    setLoading(false)
  }

  return { user, tenant, loading }
}
```

### Usage Limit Hook

```typescript
// hooks/useUsageLimit.ts
export function useUsageLimit(feature: string) {
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkUsage()
  }, [feature])

  async function checkUsage() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const response = await fetch(
      `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/check-usage-limits`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ feature })
      }
    )

    setUsage(await response.json())
    setLoading(false)
  }

  return { usage, loading, refresh: checkUsage }
}

// Usage in component
function CreatePageButton() {
  const { usage, loading } = useUsageLimit('pages')

  if (loading) return <Spinner />

  return (
    <div>
      <p>{usage.current} / {usage.limit} pages used</p>
      <button 
        disabled={!usage.allowed}
        onClick={createPage}
      >
        Create Page
      </button>
      {usage.upgrade_required && (
        <button onClick={openUpgradeModal}>Upgrade Plan</button>
      )}
    </div>
  )
}
```

---

## Testing Your Setup

### Test 1: Authentication

```bash
# Sign up a test user via Supabase dashboard or your app
# Then test login:

curl -X POST 'https://azgdvzilnusiaqxiyfce.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"email": "test@example.com", "password": "password123"}'

# Save the access_token from response
```

### Test 2: Create Tenant

```bash
curl -X POST 'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/provision-tenant' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"tenant_name": "Test Org", "slug": "test-org"}'
```

### Test 3: Check Usage

```bash
curl -X POST 'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/check-usage-limits' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"feature": "pages"}'
```

### Test 4: List Services

```bash
curl 'https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/discover-services' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

---

## Common Workflows

### Workflow A: Onboarding New User

```
1. User lands on /signup
2. User creates account (supabase.auth.signUp)
3. User confirms email
4. User redirected to /onboarding
5. User enters organization name
6. Call provision-tenant
7. Redirect to /dashboard
```

### Workflow B: Invite Flow

```
1. Admin clicks "Invite Team Member"
2. Admin enters email + role
3. Call invite-team-member
4. System sends email with invite link
5. Invitee clicks link → /invite/TOKEN
6. If new user: sign up first
7. If existing: just log in
8. Call accept-invite with token
9. Redirect to tenant dashboard
```

### Workflow C: Usage-Gated Feature

```
1. User clicks "Create New Page"
2. Call check-usage-limits { feature: 'pages' }
3. If allowed: show create form
4. If not allowed: show upgrade modal
5. After creation: call track-usage { feature: 'pages' }
```

### Workflow D: Billing

```
1. User clicks "Upgrade" on pricing page
2. Call create-checkout with price_id
3. Redirect to Stripe Checkout
4. Stripe webhook updates tenant.plan
5. User redirected back to success_url
6. App shows new plan features
```

---

## Need Help?

- **API Reference:** [API-REFERENCE.md](API-REFERENCE.md)
- **Setup Guide:** [SETUP-COMPLETE.md](SETUP-COMPLETE.md)
- **Security:** Check `functions/_shared/security.ts`

## Your Endpoints

| Action | Endpoint |
|:--|:--|
| Create tenant | POST /provision-tenant |
| Invite member | POST /invite-team-member |
| Accept invite | POST /accept-invite |
| Checkout | POST /create-checkout |
| Billing portal | POST /customer-portal |
| Check limits | POST /check-usage-limits |
| Track usage | POST /track-usage |
| Create API key | POST /create-api-key |
| Validate API key | POST /validate-api-key |
| Deploy page | POST /deploy-page |
| List services | GET /discover-services |
| Configure service | POST /configure-service |
