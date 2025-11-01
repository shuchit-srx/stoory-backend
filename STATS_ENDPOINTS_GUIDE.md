# Stats Endpoints Guide

## Endpoints

### 1. **Bid Stats**
- **Endpoint**: `GET /api/bids/stats`
- **Auth**: Required (JWT token)
- **Role-based**: Returns different stats based on user role

### 2. **Campaign Stats**
- **Endpoint**: `GET /api/campaigns/stats`
- **Auth**: Required (JWT token)
- **Role-based**: Returns different stats based on user role

## Request Format

```bash
# Bid Stats
curl -X GET "http://localhost:3000/api/bids/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Campaign Stats
curl -X GET "http://localhost:3000/api/campaigns/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Response Format

### For Influencers

**Bid Stats Response:**
```json
{
  "success": true,
  "stats": {
    "new": 10,        // All open bids (status='open')
    "pending": 3,     // Bids with matching request status AND bid.status='pending'
    "closed": 2,      // Bids with matching request status AND bid.status='closed'
    "total": 15,      // Sum: new + pending + closed
    "totalBudget": 50000
  }
}
```

**Campaign Stats Response:**
```json
{
  "success": true,
  "stats": {
    "new": 10,
    "pending": 3,
    "closed": 2,
    "total": 15,
    "totalBudget": 50000,
    "byType": {
      "service": {
        "new": 4,
        "pending": 1,
        "closed": 1,
        "total": 6
      },
      "product": {
        "new": 6,
        "pending": 2,
        "closed": 1,
        "total": 9
      }
    }
  }
}
```

### For Brand Owners

**Bid/Campaign Stats Response:**
```json
{
  "success": true,
  "stats": {
    "new": 5,         // Their created bids/campaigns with status='open'
    "pending": 3,     // Their created bids/campaigns with status='pending'
    "closed": 2,      // Their created bids/campaigns with status='closed'
    "total": 10,      // Sum: new + pending + closed
    "totalBudget": 30000
  }
}
```

## Logic Alignment

### Influencer Stats Logic (Matches Listing)

1. **"new"**: All bids/campaigns with `status='open'`
   - No filtering by interaction
   - Matches listing: `GET /api/bids?status=new` shows all open bids

2. **"pending"**: 
   - Step 1: Find bids/campaigns where influencer has requests with status in: `["connected", "negotiating", "paid", "finalized", "work_submitted", "work_approved"]`
   - Step 2: Filter those bids/campaigns where `status='pending'`
   - Matches listing: `GET /api/bids?status=pending`

3. **"closed"**:
   - Step 1: Find bids/campaigns where influencer has requests with status in: `["completed", "cancelled"]`
   - Step 2: Filter those bids/campaigns where `status='closed'`
   - Matches listing: `GET /api/bids?status=closed`

4. **"total"**: Simple sum = `new + pending + closed`

### Brand Owner Stats Logic (Matches Listing)

- **"new"**: Their created bids/campaigns with `status='open'`
- **"pending"**: Their created bids/campaigns with `status='pending'`
- **"closed"**: Their created bids/campaigns with `status='closed'`
- **"total"**: Sum = `new + pending + closed`

## Testing

### Manual Testing

1. **Login as influencer:**
```bash
curl -X POST "http://localhost:3000/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210", "token": "123456"}'
```

2. **Get bid stats:**
```bash
curl -X GET "http://localhost:3000/api/bids/stats" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

3. **Compare with listing:**
```bash
# Get pending bids from listing
curl -X GET "http://localhost:3000/api/bids?status=pending&limit=100" \
  -H "Authorization: Bearer YOUR_TOKEN"

# The count of bids in listing should match stats.pending
```

### Debug Logging

The endpoints now include debug logging:
- `[BID STATS DEBUG]` - Shows request filtering and bid fetching
- `[LISTING DEBUG]` - Shows listing filtering logic

Check server logs to see:
- How many bid IDs are filtered from requests
- How many bids match the status filter
- Final counts used in stats

## Troubleshooting

### Issue: Stats showing 1 but listing shows 3 pending

**Possible Causes:**
1. Request status mismatch - Some bids might have requests with different statuses
2. Bid status mismatch - Some bids might have different status than expected
3. Missing requests - Some bids might be accessed via conversations but not requests

**Debug Steps:**
1. Check server logs for `[BID STATS DEBUG]` messages
2. Compare:
   - `Pending bid IDs from requests` (from stats)
   - `Filtered bid IDs` (from listing)
3. Check if all 3 pending bids have matching request statuses
4. Verify bid.status is actually "pending" for all 3 bids

**Fix Applied:**
- Now uses `count` queries instead of `length` to match listing exactly
- Added debug logging to track the filtering process
- Stats now use same two-step filter as listing (request status → bid status)

## Notes

- Stats use **count queries** (not array length) to match listing behavior
- Stats are calculated using the **exact same logic** as listings
- Role is determined from JWT token (`req.user.role`)
- Stats update in real-time via socket events (`bids:stats_updated`, `campaigns:stats_updated`)

