# Real-Time Stats Updates Guide

This document describes the real-time stats update system for bids and campaigns. Stats are emitted via Socket.IO events whenever bid/campaign status changes.

## Overview

Stats updates are emitted to users via socket events:
- `bids:stats_updated` - When bid stats change
- `campaigns:stats_updated` - When campaign stats change

Both events are sent to the user's room: `user_<userId>`

## Helper Functions (`utils/statsUpdates.js`)

### Core Functions

#### `getBidsStatsForUser(userId, role)`
- Calculates bid statistics for a user
- Role-based logic:
  - **Influencer**: Filters by request status first, then bid status
  - **Brand Owner**: Counts their own bids by status
- Returns: `{ total, open, pending, closed, rejected }`

#### `getCampaignsStatsForUser(userId, role)`
- Calculates campaign statistics for a user
- Role-based logic (same as bids)
- Returns: `{ total, open, pending, closed, rejected, active, byType: { service, product } }`

#### `emitBidsStatsUpdated(userId, role, io)`
- Emits `bids:stats_updated` to `user_<userId>`
- Calculates stats using `getBidsStatsForUser()`

#### `emitCampaignsStatsUpdated(userId, role, io)`
- Emits `campaigns:stats_updated` to `user_<userId>`
- Calculates stats using `getCampaignsStatsForUser()`

#### `emitStatsUpdatesToBothUsers(brandOwnerId, influencerId, io)`
- Emits stats updates to both users in a conversation
- Gets roles for both users
- Emits both bids and campaigns stats to each user
- Used when status changes affect both parties (payment verification, work approval, etc.)

#### `emitBidStatsOnChange(createdByUserId, io)`
- Emits stats when a bid is created/updated/deleted
- Only updates the creator's stats (brand owner)
- Used in: `createBid`, `deleteBid`

#### `emitCampaignStatsOnChange(createdByUserId, io)`
- Emits stats when a campaign is created/updated/deleted
- Only updates the creator's stats (brand owner)
- Used in: `createCampaign`, `deleteCampaign`

## Integration Points

### ✅ Implemented

#### 1. **Payment Verification Handlers**
- **Bid Payment**: `controllers/bidController.js::verifyAutomatedFlowPayment()`
  - Calls `emitStatsUpdatesToBothUsers()` after payment completion
- **Campaign Payment**: `controllers/campaignController.js::verifyAutomatedFlowPayment()`
  - Calls `emitStatsUpdatesToBothUsers()` after payment completion

#### 2. **Work Submission/Approval**
- **Automated Flow**: `utils/automatedFlowService.js::handleWorkReview()`
  - When work is approved and bid/campaign status changes to "closed"
  - Calls `emitStatsUpdatesToBothUsers()` to update both users' stats

#### 3. **Creation Handlers**
- **Bid Creation**: `controllers/bidController.js::createBid()`
  - Calls `emitBidStatsOnChange()` after bid is created
- **Campaign Creation**: `controllers/campaignController.js::createCampaign()`
  - Calls `emitCampaignStatsOnChange()` after campaign is created

#### 4. **Deletion Handlers**
- **Bid Deletion**: `controllers/bidController.js::deleteBid()`
  - Calls `emitBidStatsOnChange()` after bid is deleted
- **Campaign Deletion**: `controllers/campaignController.js::deleteCampaign()`
  - Calls `emitCampaignStatsOnChange()` after campaign is deleted

## Event Format

### `bids:stats_updated`
```json
{
  "user_id": "uuid",
  "stats": {
    "new": 10,        // or "open" for brand owners
    "pending": 3,
    "closed": 2,
    "total": 15,
    "totalBudget": 50000
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `campaigns:stats_updated`
```json
{
  "user_id": "uuid",
  "stats": {
    "new": 10,        // or "open" for brand owners
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
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Frontend Integration

### Socket.IO Listener

```javascript
// Listen for stats updates
socket.on('bids:stats_updated', (data) => {
  // data.user_id - User who should receive this update
  // data.stats - Updated stats object
  // data.timestamp - When the update was sent
  
  if (data.user_id === currentUserId) {
    updateBidsStats(data.stats);
  }
});

socket.on('campaigns:stats_updated', (data) => {
  if (data.user_id === currentUserId) {
    updateCampaignsStats(data.stats);
  }
});
```

### Example: React Hook

```javascript
import { useEffect, useState } from 'react';
import { useSocket } from './useSocket';

export function useBidsStats(userId) {
  const [stats, setStats] = useState({ new: 0, pending: 0, closed: 0, total: 0 });
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !userId) return;

    // Initial fetch
    fetchBidsStats();

    // Listen for real-time updates
    const handleStatsUpdate = (data) => {
      if (data.user_id === userId) {
        setStats(data.stats);
      }
    };

    socket.on('bids:stats_updated', handleStatsUpdate);

    return () => {
      socket.off('bids:stats_updated', handleStatsUpdate);
    };
  }, [socket, userId]);

  const fetchBidsStats = async () => {
    const response = await fetch('/api/bids/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { stats } = await response.json();
    setStats(stats);
  };

  return stats;
}
```

## Testing

### Manual Testing

1. **Create a bid/campaign** → Check that brand owner's stats update
2. **Verify payment** → Check that both users' stats update
3. **Approve work** → Check that both users' stats update (campaign/bid moves to closed)
4. **Delete bid/campaign** → Check that brand owner's stats update

### Debug Logging

The helper functions include console logging:
- `➡️ [EMIT] bids:stats_updated -> user_<userId>` - Shows when stats are emitted
- `❌ Error emitting bids stats:` - Shows errors

## Notes

- **Stats Calculation**: Uses the same logic as REST endpoints (`GET /api/bids/stats`, `GET /api/campaigns/stats`)
- **Role Detection**: Automatically fetches user role from database
- **Real-time Sync**: Ensures frontend stats match backend state
- **Both Users**: When status affects both parties (payment, work approval), both users receive updates

## Alignment with REST Endpoints

The stats calculation logic in `utils/statsUpdates.js` **exactly matches** the REST endpoint logic:
- `getBidsStatsForUser()` matches `BidController.getBidStats()`
- `getCampaignsStatsForUser()` matches `CampaignController.getCampaignStats()`

This ensures socket-emitted stats match REST endpoint responses.

