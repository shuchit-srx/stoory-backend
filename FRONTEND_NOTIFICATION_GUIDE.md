# Frontend Notification Implementation Guide

This guide explains how to implement Firebase Cloud Messaging (FCM) push notifications in your frontend application to work with the Stoory backend.

## Table of Contents
1. [Overview](#overview)
2. [Backend API Endpoints](#backend-api-endpoints)
3. [Frontend Setup](#frontend-setup)
4. [Token Management](#token-management)
5. [Notification Handling](#notification-handling)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

## Overview

The Stoory backend provides a complete FCM service that handles:
- FCM token registration and management
- Push notification sending
- Token cleanup and maintenance
- Multi-platform support (Web, Android, iOS)

## Backend API Endpoints

### Base URL
```
/api/fcm
```

### Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

### Available Endpoints

#### 1. Register FCM Token
**POST** `/api/fcm/register`

Register a new FCM token for the authenticated user.

**Request Body:**
```json
{
  "token": "string (required)",
  "device_type": "web|android|ios (optional, default: web)",
  "device_id": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "FCM token registered successfully",
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "token": "string",
    "device_type": "web",
    "device_id": "string",
    "is_active": true,
    "last_used_at": "2024-01-01T00:00:00.000Z",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 2. Unregister FCM Token
**POST** `/api/fcm/unregister`

Unregister an FCM token.

**Request Body:**
```json
{
  "token": "string (required)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "FCM token unregistered successfully"
}
```

#### 3. Get User Tokens
**GET** `/api/fcm/tokens`

Get all active FCM tokens for the authenticated user.

**Response:**
```json
{
  "success": true,
  "tokens": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "token": "string",
      "device_type": "web",
      "device_id": "string",
      "is_active": true,
      "last_used_at": "2024-01-01T00:00:00.000Z",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### 4. Send Test Notification
**POST** `/api/fcm/test`

Send a test notification to the authenticated user.

**Request Body:**
```json
{
  "title": "string (optional, max 100 chars)",
  "body": "string (optional, max 200 chars)",
  "data": "object (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test notification sent",
  "sent": 1,
  "failed": 0
}
```

## Frontend Setup

### 1. Install Firebase SDK

For **React/Next.js**:
```bash
npm install firebase
```

For **Vue.js**:
```bash
npm install firebase
```

For **Angular**:
```bash
npm install firebase
```

### 2. Firebase Configuration

Create a Firebase configuration file using the values from `google-services.json`:

```javascript
// firebase-config.js
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyCNacE-M_hYUBw34fpXxTzqXT0IrigGCXY",
  authDomain: "stoory-e54ed.firebaseapp.com",
  projectId: "stoory-e54ed",
  storageBucket: "stoory-e54ed.firebasestorage.app",
  messagingSenderId: "628453246024",
  appId: "1:628453246024:web:your-web-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export { messaging, getToken, onMessage };
```

### 3. Service Worker Setup

Create a service worker file for web push notifications:

```javascript
// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCNacE-M_hYUBw34fpXxTzqXT0IrigGCXY",
  authDomain: "stoory-e54ed.firebaseapp.com",
  projectId: "stoory-e54ed",
  storageBucket: "stoory-e54ed.firebasestorage.app",
  messagingSenderId: "628453246024",
  appId: "1:628453246024:web:your-web-app-id"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || '/icon-192x192.png',
    badge: '/badge-72x72.png',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
```

## Token Management

### 1. Request Permission and Get Token

```javascript
// notification-service.js
import { messaging, getToken, onMessage } from './firebase-config';

class NotificationService {
  constructor() {
    this.token = null;
    this.isSupported = 'Notification' in window && 'serviceWorker' in navigator;
  }

  async requestPermission() {
    if (!this.isSupported) {
      console.warn('Notifications not supported');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting permission:', error);
      return false;
    }
  }

  async getFCMToken() {
    if (!this.isSupported) {
      return null;
    }

    try {
      const token = await getToken(messaging, {
        vapidKey: 'YOUR_VAPID_KEY' // Get this from Firebase Console
      });
      
      if (token) {
        this.token = token;
        console.log('FCM Token:', token);
        return token;
      } else {
        console.log('No registration token available.');
        return null;
      }
    } catch (error) {
      console.error('An error occurred while retrieving token:', error);
      return null;
    }
  }

  async registerTokenWithBackend(deviceType = 'web', deviceId = null) {
    if (!this.token) {
      throw new Error('No FCM token available');
    }

    const response = await fetch('/api/fcm/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        token: this.token,
        device_type: deviceType,
        device_id: deviceId
      })
    });

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }

    return result.data;
  }

  async unregisterToken() {
    if (!this.token) {
      return;
    }

    try {
      const response = await fetch('/api/fcm/unregister', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          token: this.token
        })
      });

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error unregistering token:', error);
      return false;
    }
  }

  setupMessageListener() {
    onMessage(messaging, (payload) => {
      console.log('Message received:', payload);
      
      // Handle foreground messages
      this.showNotification(payload.notification, payload.data);
    });
  }

  showNotification(notification, data = {}) {
    if (Notification.permission === 'granted') {
      const notificationOptions = {
        body: notification.body,
        icon: notification.icon || '/icon-192x192.png',
        badge: '/badge-72x72.png',
        data: data,
        requireInteraction: true
      };

      const notif = new Notification(notification.title, notificationOptions);
      
      notif.onclick = () => {
        // Handle notification click
        if (data.conversation_id) {
          window.location.href = `/conversations/${data.conversation_id}`;
        }
        notif.close();
      };
    }
  }
}

export default new NotificationService();
```

### 2. Initialize Notifications in Your App

```javascript
// App.js or main component
import { useEffect } from 'react';
import notificationService from './services/notification-service';

function App() {
  useEffect(() => {
    const initializeNotifications = async () => {
      // Request permission
      const hasPermission = await notificationService.requestPermission();
      
      if (hasPermission) {
        // Get FCM token
        const token = await notificationService.getFCMToken();
        
        if (token) {
          // Register with backend
          try {
            await notificationService.registerTokenWithBackend();
            console.log('Notifications initialized successfully');
          } catch (error) {
            console.error('Failed to register token:', error);
          }
        }
        
        // Setup message listener
        notificationService.setupMessageListener();
      }
    };

    initializeNotifications();

    // Cleanup on unmount
    return () => {
      notificationService.unregisterToken();
    };
  }, []);

  return (
    <div className="App">
      {/* Your app content */}
    </div>
  );
}
```

## Notification Handling

### 1. Message Types

The backend sends different types of notifications:

#### Message Notifications
```json
{
  "notification": {
    "title": "New Message",
    "body": "Message content..."
  },
  "data": {
    "type": "message",
    "conversation_id": "uuid",
    "message_id": "uuid",
    "sender_id": "uuid",
    "receiver_id": "uuid"
  }
}
```

#### Flow State Notifications
```json
{
  "notification": {
    "title": "Conversation Update",
    "body": "You have a new connection request"
  },
  "data": {
    "type": "flow_state",
    "conversation_id": "uuid",
    "flow_state": "influencer_responding"
  }
}
```

### 2. Handle Different Notification Types

```javascript
// notification-handler.js
class NotificationHandler {
  handleNotification(payload) {
    const { data } = payload;
    
    switch (data.type) {
      case 'message':
        this.handleMessageNotification(data);
        break;
      case 'flow_state':
        this.handleFlowStateNotification(data);
        break;
      default:
        console.log('Unknown notification type:', data.type);
    }
  }

  handleMessageNotification(data) {
    // Navigate to conversation
    if (data.conversation_id) {
      window.location.href = `/conversations/${data.conversation_id}`;
    }
  }

  handleFlowStateNotification(data) {
    // Handle different flow states
    const flowStateMessages = {
      'influencer_responding': 'You have a new connection request',
      'brand_owner_details': 'Please provide project details',
      'influencer_reviewing': 'Please review the project requirements',
      'brand_owner_pricing': 'Please set your price offer',
      'influencer_price_response': 'Please respond to the price offer',
      'payment_pending': 'Payment is required to continue',
      'payment_completed': 'Payment completed! You can start working',
      'work_in_progress': 'Work has started',
      'work_submitted': 'Work has been submitted for review',
      'work_approved': 'Work has been approved!',
      'real_time': 'Real-time chat is now available'
    };

    const message = flowStateMessages[data.flow_state];
    if (message) {
      // Show custom UI or navigate to appropriate page
      this.showFlowStateUpdate(message, data.conversation_id);
    }
  }

  showFlowStateUpdate(message, conversationId) {
    // Show toast, modal, or navigate to conversation
    console.log('Flow state update:', message);
  }
}
```

## Testing

### 1. Test Token Registration

```javascript
// Test notification registration
const testNotifications = async () => {
  try {
    // Get user's tokens
    const response = await fetch('/api/fcm/tokens', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });
    
    const result = await response.json();
    console.log('User tokens:', result.tokens);
    
    // Send test notification
    const testResponse = await fetch('/api/fcm/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        title: 'Test Notification',
        body: 'This is a test from the frontend',
        data: { type: 'test' }
      })
    });
    
    const testResult = await testResponse.json();
    console.log('Test notification result:', testResult);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
};
```

### 2. Test Different Scenarios

```javascript
// Test different notification scenarios
const testScenarios = {
  // Test message notification
  testMessage: async () => {
    await fetch('/api/fcm/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        title: 'New Message',
        body: 'You have received a new message',
        data: {
          type: 'message',
          conversation_id: 'test-conversation-id'
        }
      })
    });
  },

  // Test flow state notification
  testFlowState: async () => {
    await fetch('/api/fcm/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        title: 'Conversation Update',
        body: 'You have a new connection request',
        data: {
          type: 'flow_state',
          conversation_id: 'test-conversation-id',
          flow_state: 'influencer_responding'
        }
      })
    });
  }
};
```

## Troubleshooting

### Common Issues

1. **Token Registration Fails**
   - Check if user is authenticated
   - Verify FCM token is valid
   - Check network connectivity

2. **Notifications Not Received**
   - Verify service worker is registered
   - Check browser notification permissions
   - Ensure token is registered with backend

3. **Background Notifications Not Working**
   - Verify service worker file is in correct location
   - Check Firebase configuration
   - Ensure proper VAPID key setup

### Debug Steps

1. **Check Token Registration**
```javascript
// Check if token is registered
const checkTokenStatus = async () => {
  const response = await fetch('/api/fcm/tokens', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`
    }
  });
  
  const result = await response.json();
  console.log('Registered tokens:', result.tokens);
};
```

2. **Test Backend Connectivity**
```javascript
// Test if backend is reachable
const testBackend = async () => {
  try {
    const response = await fetch('/api/fcm/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        title: 'Backend Test',
        body: 'Testing backend connectivity'
      })
    });
    
    const result = await response.json();
    console.log('Backend test result:', result);
  } catch (error) {
    console.error('Backend test failed:', error);
  }
};
```

3. **Check Service Worker**
```javascript
// Check service worker registration
const checkServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      console.log('Service workers:', registrations);
    });
  }
};
```

## Environment Variables

Make sure your backend has the following environment variables set:

```env
# Firebase Configuration
FIREBASE_PROJECT_ID=stoory-e54ed
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@stoory-e54ed.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
```

## Security Notes

1. **Token Security**: FCM tokens are sensitive and should be handled securely
2. **Authentication**: Always include proper authentication headers
3. **HTTPS**: Use HTTPS in production for secure token transmission
4. **Token Cleanup**: Implement proper token cleanup on logout

## Additional Resources

- [Firebase Cloud Messaging Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Web Push Protocol](https://tools.ietf.org/html/rfc8030)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
