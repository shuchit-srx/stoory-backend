# Admin System Settings API Guide - Frontend Integration

This guide provides all the endpoints, request/response formats, and example code for integrating the Admin System Settings features into the frontend.

## Authentication

All endpoints require:
- **Authentication**: Bearer token in Authorization header
- **Role**: Admin role only (`req.user.role === 'admin'`)

```javascript
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

---

## Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/settings/system` | GET | Get all system settings (unified) |
| `/api/admin/settings/system` | PUT | Update system settings (partial updates allowed) |
| `/api/admin/settings/system/audit` | GET | Get settings change history (optional) |
| `/api/admin/settings/system/test-maintenance` | POST | Simulate maintenance mode (non-prod only) |

---

## 1. Get System Settings

**Endpoint:** `GET /api/admin/settings/system`

**Description:** Retrieves all system settings including commission rate, payout thresholds, maintenance mode, feature flags, etc. This endpoint is unified and includes settings from both `system_settings` and `commission_settings` tables.

**Headers:**
- `Authorization: Bearer <token>` (required)
- `If-None-Match: <etag>` (optional, for conditional requests)
- `If-Modified-Since: <date>` (optional, for conditional requests)

**Query Parameters:** None

**Example Request:**
```javascript
const getSystemSettings = async () => {
  const response = await fetch(
    `/api/admin/settings/system`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  // Handle 304 Not Modified (cached)
  if (response.status === 304) {
    return { success: true, cached: true };
  }

  return await response.json();
};

// Usage
const settings = await getSystemSettings();
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "commission_rate_pct": 10.0,
    "min_payout_amount": 0,
    "maintenance_mode": false,
    "currency": "INR",
    "payout_thresholds": {
      "influencer": 0
    },
    "features": {
      "escrow": false,
      "wallets": true
    },
    "updated_at": "2024-01-15T10:30:00Z",
    "updated_by": "admin-user-uuid"
  }
}
```

**Response Headers:**
- `ETag: <hash>` - Use for conditional requests
- `Last-Modified: <ISO-date>` - Use for conditional requests

**Caching Support:**
The endpoint supports HTTP conditional requests. If you send `If-None-Match` or `If-Modified-Since` headers and the data hasn't changed, you'll get a `304 Not Modified` response.

**Example with Caching:**
```javascript
const getSystemSettingsCached = async (etag = null, lastModified = null) => {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const response = await fetch(`/api/admin/settings/system`, { headers });

  if (response.status === 304) {
    return { success: true, cached: true, data: null };
  }

  const data = await response.json();
  const newEtag = response.headers.get('ETag');
  const newLastModified = response.headers.get('Last-Modified');

  return {
    ...data,
    etag: newEtag,
    lastModified: newLastModified
  };
};
```

---

## 2. Update System Settings

**Endpoint:** `PUT /api/admin/settings/system`

**Description:** Updates system settings. Supports partial updates - you only need to send the fields you want to change. When `commission_rate_pct` is updated, it automatically syncs to the `commission_settings` table for backward compatibility.

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)

**Request Body:** (All fields are optional - partial updates allowed)
```json
{
  "commission_rate_pct": 15.0,
  "min_payout_amount": 100,
  "maintenance_mode": false,
  "currency": "INR",
  "payout_thresholds": {
    "influencer": 500
  },
  "features": {
    "escrow": true,
    "wallets": true
  }
}
```

**Validation Rules:**
- `commission_rate_pct`: Number, 0-100
- `min_payout_amount`: Number, ≥ 0
- `maintenance_mode`: Boolean
- `currency`: String, ISO 4217 format (e.g., "INR")
- `payout_thresholds.influencer`: Number, ≥ 0
- `features.escrow`: Boolean
- `features.wallets`: Boolean

**Example Request:**
```javascript
const updateSystemSettings = async (updates) => {
  const response = await fetch(
    `/api/admin/settings/system`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    }
  );

  return await response.json();
};

// Usage - Update only commission rate
await updateSystemSettings({
  commission_rate_pct: 15.0
});

// Usage - Update multiple settings
await updateSystemSettings({
  commission_rate_pct: 12.5,
  min_payout_amount: 100,
  maintenance_mode: false,
  features: {
    escrow: true,
    wallets: true
  }
});

// Usage - Update nested objects (merges with existing)
await updateSystemSettings({
  payout_thresholds: {
    influencer: 500
  }
});
```

**Success Response Format:**
```json
{
  "success": true,
  "data": {
    "commission_rate_pct": 15.0,
    "min_payout_amount": 100,
    "maintenance_mode": false,
    "currency": "INR",
    "payout_thresholds": {
      "influencer": 500
    },
    "features": {
      "escrow": true,
      "wallets": true
    },
    "updated_at": "2024-01-15T10:30:00Z",
    "updated_by": "admin-user-uuid"
  }
}
```

**Response Headers:**
- `ETag: <hash>` - Updated ETag for caching
- `Last-Modified: <ISO-date>` - Updated timestamp

**Error Response Format (Validation):**
```json
{
  "success": false,
  "message": "Validation error",
  "errors": {
    "commission_rate_pct": "Must be between 0 and 100",
    "min_payout_amount": "Must be a number >= 0"
  }
}
```

**Error Response Format (Server Error):**
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Detailed error message (in development)"
}
```

---

## 3. Get Settings Audit History (Optional)

**Endpoint:** `GET /api/admin/settings/system/audit`

**Description:** Retrieves the audit log of all settings changes. Shows who changed what, when, and from which IP address.

**Query Parameters:**
- `limit` (number, default: 50, max: 200) - Number of audit entries to return

**Example Request:**
```javascript
const getSettingsAudit = async (limit = 50) => {
  const params = new URLSearchParams({
    limit: limit.toString()
  });

  const response = await fetch(
    `/api/admin/settings/system/audit?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "data": [
    {
      "id": "audit-uuid",
      "settings_id": "system",
      "old_data": {
        "commission_rate_pct": 10.0,
        "maintenance_mode": false
      },
      "new_data": {
        "commission_rate_pct": 15.0,
        "maintenance_mode": false
      },
      "updated_by": "admin-user-uuid",
      "updated_by_email": "admin@example.com",
      "ip_address": "192.168.1.1",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## 4. Test Maintenance Mode (Optional, Non-Prod Only)

**Endpoint:** `POST /api/admin/settings/system/test-maintenance`

**Description:** Simulates maintenance mode for testing purposes. Only works in non-production environments.

**Example Request:**
```javascript
const testMaintenance = async () => {
  const response = await fetch(
    `/api/admin/settings/system/test-maintenance`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format (Success):**
```json
{
  "success": true,
  "message": "Maintenance simulation accepted (client-side should gate UI for 60s)"
}
```

**Response Format (Production):**
```json
{
  "success": false,
  "message": "Not allowed in production"
}
```

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error message (in development)"
}
```

**Common Error Codes:**
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (not an admin user, or production restriction)
- `500` - Internal server error

**Example Error Handling:**
```javascript
const handleApiCall = async (apiFunction) => {
  try {
    const response = await apiFunction();
    
    if (!response.success) {
      // Handle validation errors
      if (response.errors) {
        console.error('Validation errors:', response.errors);
        // Display field-level errors to user
        return { success: false, errors: response.errors };
      }
      
      console.error('API Error:', response.message);
      // Show toast/notification
      return { success: false, message: response.message };
    }
    
    return response;
  } catch (error) {
    console.error('Network Error:', error);
    // Handle network error
    return { success: false, message: 'Network error occurred' };
  }
};
```

---

## React Hook Example

```javascript
import { useState, useEffect, useCallback } from 'react';

const useSystemSettings = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [etag, setEtag] = useState(null);
  const [lastModified, setLastModified] = useState(null);
  const token = localStorage.getItem('token');

  const fetchSettings = useCallback(async (useCache = true) => {
    setLoading(true);
    setError(null);
    
    try {
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (useCache && etag) {
        headers['If-None-Match'] = etag;
      }
      if (useCache && lastModified) {
        headers['If-Modified-Since'] = lastModified;
      }

      const response = await fetch('/api/admin/settings/system', { headers });
      
      if (response.status === 304) {
        // Data hasn't changed, use cached settings
        setLoading(false);
        return { success: true, cached: true };
      }

      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to fetch settings');
      }

      // Update cache headers
      const newEtag = response.headers.get('ETag');
      const newLastModified = response.headers.get('Last-Modified');
      
      if (newEtag) setEtag(newEtag);
      if (newLastModified) setLastModified(newLastModified);

      setSettings(data.data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [token, etag, lastModified]);

  const updateSettings = useCallback(async (updates) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/admin/settings/system', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      const data = await response.json();
      
      if (!response.ok || !data.success) {
        if (data.errors) {
          // Validation errors
          throw { validation: true, errors: data.errors };
        }
        throw new Error(data.message || 'Failed to update settings');
      }

      // Update cache headers
      const newEtag = response.headers.get('ETag');
      const newLastModified = response.headers.get('Last-Modified');
      
      if (newEtag) setEtag(newEtag);
      if (newLastModified) setLastModified(newLastModified);

      setSettings(data.data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [token]);

  return {
    loading,
    error,
    settings,
    fetchSettings,
    updateSettings,
    refresh: () => fetchSettings(false) // Force refresh without cache
  };
};

// Usage in component
const SettingsPage = () => {
  const { loading, error, settings, fetchSettings, updateSettings } = useSystemSettings();
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      setFormData({
        commission_rate_pct: settings.commission_rate_pct,
        min_payout_amount: settings.min_payout_amount,
        maintenance_mode: settings.maintenance_mode,
        currency: settings.currency,
        payout_thresholds: { ...settings.payout_thresholds },
        features: { ...settings.features }
      });
    }
  }, [settings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors({});

    try {
      await updateSettings(formData);
      // Show success toast
      alert('Settings updated successfully!');
    } catch (err) {
      if (err.validation) {
        setFieldErrors(err.errors);
      } else {
        alert(`Error: ${err.message}`);
      }
    }
  };

  if (loading && !settings) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Commission Rate (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={formData.commission_rate_pct}
          onChange={(e) => setFormData({
            ...formData,
            commission_rate_pct: parseFloat(e.target.value)
          })}
        />
        {fieldErrors.commission_rate_pct && (
          <span className="error">{fieldErrors.commission_rate_pct}</span>
        )}
      </div>

      <div>
        <label>Min Payout Amount</label>
        <input
          type="number"
          min="0"
          value={formData.min_payout_amount}
          onChange={(e) => setFormData({
            ...formData,
            min_payout_amount: parseFloat(e.target.value)
          })}
        />
        {fieldErrors.min_payout_amount && (
          <span className="error">{fieldErrors.min_payout_amount}</span>
        )}
      </div>

      <div>
        <label>
          <input
            type="checkbox"
            checked={formData.maintenance_mode}
            onChange={(e) => setFormData({
              ...formData,
              maintenance_mode: e.target.checked
            })}
          />
          Maintenance Mode
        </label>
      </div>

      <div>
        <label>Influencer Payout Threshold</label>
        <input
          type="number"
          min="0"
          value={formData.payout_thresholds.influencer}
          onChange={(e) => setFormData({
            ...formData,
            payout_thresholds: {
              ...formData.payout_thresholds,
              influencer: parseFloat(e.target.value)
            }
          })}
        />
        {fieldErrors['payout_thresholds.influencer'] && (
          <span className="error">{fieldErrors['payout_thresholds.influencer']}</span>
        )}
      </div>

      <div>
        <label>
          <input
            type="checkbox"
            checked={formData.features.escrow}
            onChange={(e) => setFormData({
              ...formData,
              features: {
                ...formData.features,
                escrow: e.target.checked
              }
            })}
          />
          Enable Escrow
        </label>
      </div>

      <div>
        <label>
          <input
            type="checkbox"
            checked={formData.features.wallets}
            onChange={(e) => setFormData({
              ...formData,
              features: {
                ...formData.features,
                wallets: e.target.checked
              }
            })}
          />
          Enable Wallets
        </label>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Updating...' : 'Update Settings'}
      </button>
    </form>
  );
};
```

---

## TypeScript Types (Optional)

```typescript
interface SystemSettings {
  commission_rate_pct: number;
  min_payout_amount: number;
  maintenance_mode: boolean;
  currency: string;
  payout_thresholds: {
    influencer: number;
  };
  features: {
    escrow: boolean;
    wallets: boolean;
  };
  updated_at: string | null;
  updated_by: string | null;
}

interface SystemSettingsResponse {
  success: boolean;
  data: SystemSettings;
}

interface SystemSettingsUpdateRequest {
  commission_rate_pct?: number;
  min_payout_amount?: number;
  maintenance_mode?: boolean;
  currency?: string;
  payout_thresholds?: {
    influencer?: number;
  };
  features?: {
    escrow?: boolean;
    wallets?: boolean;
  };
}

interface ValidationErrorResponse {
  success: false;
  message: string;
  errors: {
    [key: string]: string;
  };
}

interface AuditEntry {
  id: string;
  settings_id: string;
  old_data: Partial<SystemSettings>;
  new_data: Partial<SystemSettings>;
  updated_by: string;
  updated_by_email: string | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditResponse {
  success: boolean;
  data: AuditEntry[];
}
```

---

## Notes

1. **Partial Updates**: PUT endpoint supports partial updates. You only need to send the fields you want to change.

2. **Nested Objects**: When updating nested objects like `payout_thresholds` or `features`, the update merges with existing values. To replace entirely, send the full object.

3. **Commission Sync**: When `commission_rate_pct` is updated, it automatically syncs to the `commission_settings` table for backward compatibility with existing commission endpoints.

4. **Caching**: Use ETag and Last-Modified headers for efficient caching. The endpoint returns `304 Not Modified` if data hasn't changed.

5. **Audit Logging**: All updates are automatically logged to the audit table with old/new values, user info, and IP address.

6. **Validation**: Field-level validation errors are returned in the `errors` object, making it easy to display inline errors in forms.

7. **Backward Compatibility**: The unified settings endpoint works alongside existing commission endpoints (`/api/admin/commission/*`). Both can be used, but the unified endpoint is recommended for new code.

---

## Quick Reference

**Base URL**: `/api/admin/settings`

**Common Headers**:
```javascript
{
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}
```

**Response Structure**:
```json
{
  "success": true|false,
  "data": {...},
  "message": "Error message (if failed)",
  "errors": {...} // Validation errors (if failed)
}
```

**Field Validation**:
- `commission_rate_pct`: 0-100
- `min_payout_amount`: ≥ 0
- `currency`: ISO 4217 (3 letters)
- `payout_thresholds.influencer`: ≥ 0
- All feature flags: boolean

---

## Migration from Commission Endpoints

If you're currently using `/api/admin/commission/*` endpoints, you can migrate to the unified settings:

**Old Way:**
```javascript
// Get commission
const comm = await fetch('/api/admin/commission/current');
// Update commission
await fetch('/api/admin/commission/update', {
  method: 'PUT',
  body: JSON.stringify({ commission_percentage: 15.0 })
});
```

**New Way (Unified):**
```javascript
// Get all settings (including commission)
const settings = await fetch('/api/admin/settings/system');
// Update commission (and other settings if needed)
await fetch('/api/admin/settings/system', {
  method: 'PUT',
  body: JSON.stringify({ commission_rate_pct: 15.0 })
});
```

**Note**: Both approaches work, but the unified endpoint is recommended for new code as it provides a single source of truth for all system settings.

