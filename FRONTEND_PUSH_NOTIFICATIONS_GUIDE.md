# Frontend Push Notifications Guide (Unified: Socket + FCM)

This guide shows how to implement real-time push-style notifications on the frontend for BOTH:
- Socket events (online users) → show native push-style banners (not just toasts)
- FCM push notifications (offline or background)

It covers React Native/Expo and Web (PWA). All real-time, non-FCM events should surface as push-like banners in-app.

---

## Architecture Overview

- **Socket.IO**: Real-time events for online users. Backend emits `notification`, `new_message`, and others (see `sockets/messageHandler.js`).
- **FCM**: Push notifications for offline/background; also usable when app is foreground if desired.
- **Unified UX Goal**: When a `notification` arrives via socket AND the app is foreground, still show a banner-style notification, not a toast. When the app is background or user is offline, FCM handles delivery.

Key backend references:
- Socket events and rooms: `sockets/messageHandler.js`
- FCM sending and iOS banner fix: `services/fcmService.js`, `FCM_BANNER_NOTIFICATION_FIX.md`
- Test endpoints: `index.js` `/api/test-socket-notification`, `/api/test-socket-notification-all`, `/api/online-users`, `/test-message`, `/test-fcm`

---

## When notifications are sent (FCM vs Socket)

- Socket (real-time) is emitted when the user is online (joined `user_${userId}` room)
  - New message: `new_message` + `notification` from `sockets/messageHandler.js`
  - Conversation updates: `conversation_list_updated`, `unread_count_updated`
  - State changes: `conversation_state_changed`, `payment_status_update`
- FCM (push) is sent for persistence and when the user may be offline/background
  - `fcmService.sendMessageNotification`: on messages
  - `fcmService.sendFlowStateNotification`: on flow state changes (advance/final, etc.)
  - Webhook/payment events can also trigger FCM to both parties as needed
- The backend stores notifications first, then selects channel based on online status; admins receive persistent notifications for payment actions.

Rule of thumb:
- Online/foreground: Socket delivers instantly; frontend must show banner.
- Offline/background: FCM delivers; system shows banner via OS.

---

## Requirements

- Single socket connection (singleton) on frontend.
- Register FCM token and request permissions.
- Foreground handler must display banner-style notification (RN/Expo and Web) for both socket and FCM.

---

## React Native / Expo Implementation

### 1) Install deps
```bash
npm install socket.io-client expo-notifications
```

### 2) Configure Expo notifications (foreground banners)
```javascript
// notifications/config.ts
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,      // Show banner in foreground
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermissions() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}
```

### 3) Unified Socket Service (singleton)
```javascript
// services/MessageSocketService.ts
import io from 'socket.io-client';

class MessageSocketService {
  static instance;
  socket = null;
  userId = null;
  listeners = new Map();

  static getInstance() {
    if (!MessageSocketService.instance) {
      MessageSocketService.instance = new MessageSocketService();
    }
    return MessageSocketService.instance;
  }

  connect(userId, serverUrl) {
    if (this.socket?.connected) return;
    this.userId = userId;
    const url = serverUrl || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      this.socket.emit('join', this.userId);
      this.socket.emit('request_global_notifications', this.userId);
    });

    const events = [
      'notification',
      'new_message',
      'conversation_list_updated',
      'unread_count_updated',
      'typing_status_update',
      'message_seen',
    ];

    events.forEach((event) => {
      this.socket.on(event, (data) => this.emit(event, data));
    });
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) set.forEach((cb) => cb(data));
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.listeners.clear();
    }
  }
}

export const messageSocketService = MessageSocketService.getInstance();
```

### 4) Show push-style banners for socket notifications
```javascript
// notifications/inAppBanner.ts
import * as Notifications from 'expo-notifications';

export async function showInAppBanner({ title, body, data }) {
  // Uses Expo foreground handler to present as banner
  await Notifications.presentNotificationAsync({
    title: title || 'Notification',
    body: body || '',
    data: data || {},
    sound: 'default',
  });
}
```

### 5) Wire up socket → banner in a provider
```javascript
// contexts/UnifiedNotificationProvider.tsx
import React, { useEffect, useState } from 'react';
import { messageSocketService } from '../services/MessageSocketService';
import { requestNotificationPermissions } from '../notifications/config';
import { showInAppBanner } from '../notifications/inAppBanner';

export const UnifiedNotificationProvider = ({ userId, children }) => {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    (async () => { await requestNotificationPermissions(); })();
    if (!userId) return;
    messageSocketService.connect(userId);

    const offNotif = messageSocketService.on('notification', (payload) => {
      const title = payload?.data?.title || payload?.title || 'New Notification';
      const body = payload?.data?.body || payload?.message || '';
      showInAppBanner({ title, body, data: payload?.data });
      setUnread((u) => u + 1);
    });

    const offUnread = messageSocketService.on('unread_count_updated', (d) => {
      if (d?.action === 'increment') setUnread((u) => u + (d.unread_count || 1));
      if (d?.action === 'reset') setUnread(d.unread_count || 0);
    });

    return () => { offNotif(); offUnread(); messageSocketService.disconnect(); };
  }, [userId]);

  return <>{children}</>;
};
```

Result: When socket `notification` arrives and app is foreground, a banner shows (not a toast). When background/offline, FCM will deliver push.

---

## Socket configuration and port

- Server runs on `PORT` env (default `3000`). Socket.IO shares the same origin/port.
- CORS allowed origins include common localhost ports and production hosts (see `index.js` `io` setup).
- Client URL examples:
  - Development: `http://localhost:3000`
  - LAN: `http://192.168.x.x:3000`
  - Production: set `EXPO_PUBLIC_API_URL` or web `VITE_API_URL` to your backend URL.

Keep-alive and reliability (already configured on server):
- pingInterval 25s, pingTimeout 60s, reconnection supported, transports: `websocket` and fallback `polling`.

Client reliability tips:
- Enable `reconnection: true`, `reconnectionAttempts`, and listen for `connect_error` to retry.
- Reconnect on auth/session refresh and app resume.
- For Expo/RN, re-init socket in an app state listener when app returns to foreground.
- For web, keep one global socket; avoid creating multiple instances across tabs.

Always-on considerations:
- Mobile OS may pause background sockets. Use FCM to wake users for critical events.
- Web PWAs should use FCM/service worker for background notifications.

---

## Web (PWA) Implementation

### 1) Request permission and show banners
```javascript
// web/notifications.ts
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function showBanner({ title, body, data }) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title || 'Notification', {
    body: body || '',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    requireInteraction: true,
    data: data || {},
  });
  n.onclick = (e) => {
    const convoId = e?.target?.data?.conversation_id;
    if (convoId) window.location.href = `/conversations/${convoId}`;
    n.close();
  };
}
```

### 2) Socket → banner
```javascript
// web/socketBanners.ts
import { io } from 'socket.io-client';
import { requestNotificationPermission, showBanner } from './notifications';

export function initSocket(userId, serverUrl) {
  const url = serverUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const socket = io(url, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('join', userId);
    socket.emit('request_global_notifications', userId);
  });

  socket.on('notification', async (payload) => {
    await requestNotificationPermission();
    const title = payload?.data?.title || payload?.title || 'New Notification';
    const body = payload?.data?.body || payload?.message || '';
    showBanner({ title, body, data: payload?.data });
  });

  return socket;
}
```

Result: Socket notifications also present as push-like banners on web.

---

## FCM Integration Notes

- Backend already fixed iOS silent issue by removing `content-available: 1` and using proper APNs alert payload. See `FCM_BANNER_NOTIFICATION_FIX.md` and `services/fcmService.js`.
- Frontend must:
  - Request permissions (see RN/Expo and Web examples above).
  - Register device tokens via your API (`/api/fcm/register`).
  - Handle notification taps to navigate to the right screen.

---

## Testing

Use existing backend endpoints (see `index.js`):

- Check online users:
```bash
curl http://localhost:3000/api/online-users
```

- Send to specific user (socket):
```bash
curl -X POST http://localhost:3000/api/test-socket-notification \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "<USER_ID>",
    "title": "Test",
    "message": "Socket banner test"
  }'
```

- Send to all online users (socket):
```bash
curl -X POST http://localhost:3000/api/test-socket-notification-all \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test to All",
    "message": "Socket banner test to all"
  }'
```

- End-to-end realtime message emit (socket + FCM):
```bash
curl -X POST http://localhost:3000/test-message \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "<CONV_ID>",
    "senderId": "<SENDER_ID>",
    "receiverId": "<RECEIVER_ID>",
    "message": "Hello"
  }'
```

- Check FCM service status:
```bash
curl http://localhost:3000/test-fcm
```

Expected:
- Online user: socket `notification` triggers a foreground banner via Expo/Web handler.
- Offline/background: FCM banner delivered (iOS banner fix applied).

---

## Keeping users “always active” for socket

- Join rooms on connect: `socket.emit('join', userId)` and optionally `request_global_notifications`.
- Re-join after reconnect automatically in your service’s `connect` handler.
- Persist auth and userId locally so the socket can reconnect without user action.
- Use FCM for background re-engagement; on tap, app opens and socket reconnects.

Recommended client options (already shown):
- RN/Expo: `transports: ['websocket','polling'], reconnection: true, reconnectionAttempts: 5`
- Web: same transport/reconnection options.

Health monitoring:
- Optionally poll `/health` and `/api/online-users` in dev to verify connectivity.

---

## Production Tips

- Use environment-based socket URL selection.
- Ensure notification channels on Android and APNs setup on iOS.
- De-dupe events: maintain a single socket listener path to avoid duplicate banners.

---

## Summary

- Socket events now surface as push-style banners in-app (no toasts-only), matching FCM UX.
- Offline/background users receive the same via FCM.
- Use the provided endpoints to verify delivery paths and UX end-to-end.
