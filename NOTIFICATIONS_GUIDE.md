# Notifications System Guide

## Overview

The notification system handles both **in-app notifications** (stored in DB) and **push notifications** (FCM). Notifications are **never auto-marked as read** - they remain unread until the user explicitly marks them as read.

---

## Database Schema

**Table: `notifications`**
- `id` - UUID
- `user_id` - UUID (notification recipient)
- `type` - string (e.g., 'message', 'flow_state', 'direct_connection_created', 'admin_payment_pending_advance')
- `status` - 'pending' | 'delivered' (set to 'delivered' when user marks as read)
- `priority` - 'low' | 'medium' | 'high'
- `title` - string
- `message` - string
- `data` - JSONB (custom data)
- `action_url` - string (optional deep link)
- `read_at` - timestamp (null = unread)
- `expires_at` - timestamp (optional)
- `created_at` - timestamp

**Important:** Notifications start with `status: 'pending'` and `read_at: null`. They are **NEVER auto-marked as read**.

---

## REST API Endpoints

### 1. Get Notifications
```
GET /api/notifications
Query params:
  - page (default: 1)
  - limit (default: 20)
  - status (optional: 'pending' | 'delivered')
  - type (optional: filter by notification type)
  - unread_only (optional: 'true' to get only unread)
  - mark_read_on_view (optional: 'true' to mark all as read when opening screen)

Response:
{
  "success": true,
  "notifications": [
    {
      "id": "...",
      "user_id": "...",
      "type": "message",
      "status": "pending",
      "priority": "medium",
      "title": "...",
      "message": "...",
      "data": {...},
      "action_url": "/conversations/...",
      "read_at": null,  // null = unread (will be set if mark_read_on_view=true)
      "created_at": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "pages": 3
  },
  "unread_count": 0,  // Updated count after mark_read_on_view
  "marked_read_on_view": true  // If mark_read_on_view was used
}
```

**Note:** When `mark_read_on_view=true`, all unread notifications are marked as read automatically when you open the screen (no tap needed). This is useful for WhatsApp-like behavior where viewing = reading.

### 2. Get Unread Count
```
GET /api/notifications/unread-count

Response:
{
  "success": true,
  "count": 5
}
```

### 3. Mark Notification as Read
```
PUT /api/notifications/:notificationId/read

Response:
{
  "success": true,
  "message": "Notification marked as read",
  "notification": {...},
  "unread_count": 4
}
```

**Note:** Only marks ONE notification as read. Does NOT auto-mark others.

### 4. Mark All as Read
```
PUT /api/notifications/mark-all-read

Response:
{
  "success": true,
  "message": "All notifications marked as read",
  "unread_count": 0
}
```

### 5. Delete Single Notification
```
DELETE /api/notifications/:notificationId

Response:
{
  "success": true,
  "message": "Notification deleted",
  "unread_count": 4
}
```

### 6. Delete All Notifications
```
DELETE /api/notifications

Response:
{
  "success": true,
  "message": "All notifications cleared",
  "unread_count": 0
}
```

---

## Socket.IO Events (Realtime)

### Client → Server
None required for notifications (all operations via REST API)

### Server → Client

All events are emitted to `user_<userId>` room:

1. **New Notification**
   ```javascript
   socket.on('notification:new', ({ notification }) => {
     // Add to notification list
     // Increment unread count
     // Show badge/indicator
   });
   ```

2. **Notification Updated (Marked as Read)**
   ```javascript
   socket.on('notification_updated', ({ id, read_at, status }) => {
     // Update notification in list
     // Update read_at timestamp
     // Update unread count
   });
   ```

3. **All Notifications Marked as Read**
   ```javascript
   socket.on('notifications_all_read', ({ user_id }) => {
     // Mark all in list as read
     // Reset unread count to 0
   });
   ```

4. **Notification Deleted**
   ```javascript
   socket.on('notification_deleted', ({ id }) => {
     // Remove notification from list
   });
   ```

5. **All Notifications Cleared**
   ```javascript
   socket.on('notifications_cleared', ({ user_id }) => {
     // Clear notification list
   });
   ```

6. **Unread Count Updated**
   ```javascript
   socket.on('unread_count_updated', ({ count }) => {
     // Update unread badge/indicator
   });
   ```

---

## Push Notifications (FCM) vs In-App Notifications

### In-App Notifications (Always Stored)
- **Stored in DB** when created via `notificationService.storeNotification()`
- **Visible in notification screen**
- **Never auto-marked as read**
- **Can be deleted**

### Push Notifications (FCM)
- **Only sent when user is NOT actively viewing the conversation**
- **Sent via FCM** for offline users or users not viewing that chat
- **FCM and in-app notifications are separate:**
  - FCM = push to device (temporary, disappears when tapped)
  - In-app = stored in DB (persistent, shown in notification screen)

### How They Work Together
1. **Message sent** → Notification stored in DB → FCM sent (if user not viewing chat)
2. **Notification appears in screen** → User can mark as read → Delete when done
3. **FCM push** → User taps → Opens app → In-app notification still visible

**Important:** FCM push notifications do NOT mark in-app notifications as read. They are independent.

---

## Frontend Implementation Guide

### 1. Setup Socket Listener

```javascript
// After socket authentication
socket.on('notification:new', handleNewNotification);
socket.on('notification_updated', handleNotificationUpdated);
socket.on('notifications_all_read', handleAllRead);
socket.on('notification_deleted', handleNotificationDeleted);
socket.on('notifications_cleared', handleAllCleared);
socket.on('unread_count_updated', handleUnreadCountUpdate);
```

### 2. Load Notifications on Screen Open (with auto-mark as read)

```javascript
async function loadNotifications(page = 1, markAsRead = true) {
  // Use mark_read_on_view=true to auto-mark all as read when opening screen
  const url = `/api/notifications?page=${page}&limit=20${markAsRead ? '&mark_read_on_view=true' : ''}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    setNotifications(data.notifications);
    setPagination(data.pagination);
    setUnreadCount(data.unread_count); // Updated count after marking as read
    
    // If marked as read, update local state
    if (data.marked_read_on_view) {
      // All notifications are now read - update UI
      setNotifications(prev => prev.map(n => ({ 
        ...n, 
        read_at: new Date().toISOString(), 
        status: 'delivered' 
      })));
    }
  }
}
```

### 3. Get Unread Count

```javascript
async function getUnreadCount() {
  const response = await fetch('/api/notifications/unread-count', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    setUnreadCount(data.count);
  }
}
```

### 4. Mark as Read

```javascript
async function markAsRead(notificationId) {
  const response = await fetch(`/api/notifications/${notificationId}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    // Socket event will update UI automatically
    // Or update local state:
    updateNotificationInList(notificationId, { read_at: new Date() });
    setUnreadCount(data.unread_count);
  }
}
```

### 5. Mark All as Read

```javascript
async function markAllAsRead() {
  const response = await fetch('/api/notifications/mark-all-read', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    // Socket event will clear all
    // Or update local state:
    markAllInListAsRead();
    setUnreadCount(0);
  }
}
```

### 6. Delete Notification

```javascript
async function deleteNotification(notificationId) {
  const response = await fetch(`/api/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    // Socket event will remove it
    // Or update local state:
    removeNotificationFromList(notificationId);
    setUnreadCount(data.unread_count);
  }
}
```

### 7. Delete All Notifications

```javascript
async function deleteAllNotifications() {
  const response = await fetch('/api/notifications', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (data.success) {
    // Socket event will clear all
    // Or update local state:
    clearNotificationList();
    setUnreadCount(0);
  }
}
```

### 8. Delete Button Implementation (Per Notification)

```javascript
// Add delete button to each notification item
function NotificationItem({ notification }) {
  const handleDelete = async () => {
    if (confirm('Delete this notification?')) {
      await deleteNotification(notification.id);
    }
  };

  return (
    <div className="notification-item">
      <div className="notification-content">
        <h3>{notification.title}</h3>
        <p>{notification.message}</p>
        <span>{new Date(notification.created_at).toLocaleString()}</span>
      </div>
      <button onClick={handleDelete} className="delete-btn">
        🗑️ Delete
      </button>
    </div>
  );
}
```

### 9. Delete All Button Implementation

```javascript
// Add "Clear All" or "Delete All" button in notification screen header
function NotificationScreen() {
  const handleDeleteAll = async () => {
    if (confirm('Delete all notifications?')) {
      await deleteAllNotifications();
    }
  };

  return (
    <div className="notification-screen">
      <div className="header">
        <h1>Notifications</h1>
        <button onClick={handleDeleteAll} className="delete-all-btn">
          🗑️ Clear All
        </button>
      </div>
      {/* Notification list */}
    </div>
  );
}
```

### 10. Handle Socket Events

```javascript
function handleNewNotification({ notification }) {
  // Add to top of list
  setNotifications(prev => [notification, ...prev]);
  
  // Increment unread count
  setUnreadCount(prev => prev + 1);
  
  // Show badge/indicator
  showNotificationBadge();
}

function handleNotificationUpdated({ id, read_at, status }) {
  // Update in list
  setNotifications(prev => 
    prev.map(n => n.id === id ? { ...n, read_at, status } : n)
  );
  
  // Decrement unread count if was unread
  if (read_at) {
    setUnreadCount(prev => Math.max(0, prev - 1));
  }
}

function handleAllRead({ user_id }) {
  // Mark all as read
  setNotifications(prev => 
    prev.map(n => ({ ...n, read_at: new Date(), status: 'delivered' }))
  );
  setUnreadCount(0);
}

function handleNotificationDeleted({ id }) {
  // Remove from list
  setNotifications(prev => prev.filter(n => n.id !== id));
}

function handleAllCleared({ user_id }) {
  // Clear list
  setNotifications([]);
  setUnreadCount(0);
}

function handleUnreadCountUpdate({ count }) {
  // Update count (sync with server)
  setUnreadCount(count);
}
```

---

## Important Notes

### ✅ DO:
- Load notifications on screen open
- Use `mark_read_on_view=true` query param to auto-mark as read when opening screen (WhatsApp-like behavior)
- Show **delete button** on each notification item
- Provide **"Clear All"** or **"Delete All"** button in notification screen
- Listen to socket events for realtime updates
- Update unread count when marking as read/deleting
- Show unread badge based on `read_at === null`
- Delete notifications when user wants to clear them

### ❌ DON'T:
- **Auto-mark notifications as read** without user opening the screen (only mark when `mark_read_on_view=true`)
- **Assume FCM push = read** (they're separate)
- **Delete notifications automatically** (let user control with delete buttons)

### Notification States

1. **Unread**: `read_at === null`, `status === 'pending'`
2. **Read**: `read_at !== null`, `status === 'delivered'`
3. **Deleted**: Removed from DB (won't appear in list)

### Filtering

- **Unread only**: `GET /api/notifications?unread_only=true`
- **By type**: `GET /api/notifications?type=message`
- **By status**: `GET /api/notifications?status=delivered`

---

## Troubleshooting

### Notifications not appearing in screen
- ✅ Check API call returns `success: true`
- ✅ Verify `notificationService.storeNotification()` is called when events occur
- ✅ Check socket listener is connected and listening

### Notifications auto-marking as read
- ✅ **This should NOT happen** - check frontend code for auto-mark logic
- ✅ Only `PUT /api/notifications/:id/read` should mark as read
- ✅ Backend never auto-marks notifications

### Unread count not updating
- ✅ Listen to `unread_count_updated` socket event
- ✅ Call `GET /api/notifications/unread-count` on screen open
- ✅ Update count when marking as read/deleting

### Delete not working
- ✅ Verify endpoint returns `success: true`
- ✅ Check socket `notification_deleted` event is received
- ✅ Update local state when socket event received

---

## Example Notification Types

- `message` - New message in conversation
- `flow_state` - Conversation state change
- `direct_connection_created` - New direct connection
- `admin_payment_pending_advance` - Admin needs to release advance
- `admin_payment_pending_final` - Admin needs to release final payment
- `payment_completed` - Payment verified
- `work_submitted` - Work submitted for review
- `work_approved` - Work approved

---

## Summary

1. **Notifications are stored** when events occur (messages, state changes, etc.)
2. **FCM push** is sent only if user is not viewing that conversation
3. **Notifications remain unread** until user explicitly marks them
4. **Delete/clear** works and updates count in realtime
5. **Socket events** keep UI in sync automatically
6. **Frontend** should load notifications and listen to socket events for updates

