# Subscription Handling Guide

## 🎯 Overview

This guide explains how user subscription checks are handled in the backend and how the frontend should respond to subscription-related scenarios.

---

## 🏗️ Backend Subscription System

### 1. **Database Functions**

The backend uses two main database functions to check subscription status:

#### `has_active_premium_subscription(user_uuid UUID)`
```sql
-- Returns BOOLEAN indicating if user has active premium subscription
-- Includes 2-day grace period for expired subscriptions
SELECT has_active_premium_subscription('user-uuid-here');
```

#### `get_user_subscription_status(user_uuid UUID)`
```sql
-- Returns JSON with detailed subscription information
SELECT get_user_subscription_status('user-uuid-here');
-- Returns: {
--   "has_active_subscription": true,
--   "subscription": {
--     "id": "sub_123",
--     "plan_id": "1month",
--     "plan_name": "1 Month",
--     "status": "active",
--     "start_date": "2024-01-01",
--     "end_date": "2024-02-01",
--     "amount_paid": 499.00
--   }
-- }
```

### 2. **Subscription Plans Available**

```sql
-- Available subscription plans
INSERT INTO plans (id, name, price, period, description, highlight) VALUES
('10days', '10 Days Trial', 199.00, '10 days', 'Short-term access for quick needs', false),
('1month', '1 Month', 499.00, '1 month', 'Best for trying out all features', false),
('3months', '3 Months', 1200.00, '3 months', 'Save more with a quarterly plan', false),
('6months', '6 Months', 2500.00, '6 months', 'Half-year access at a great value', false),
('1year', '1 Year', 4999.00, '1 year', 'Best value for long-term users', true);
```

---

## 🔐 Route-Level Subscription Checks

### 1. **Bid Creation** (`POST /api/bids`)

**Backend Check:**
```javascript
// Check subscription status for brand owners
if (req.user.role === "brand_owner") {
  const { data: hasPremiumAccess } = await supabaseAdmin.rpc(
    "has_active_premium_subscription",
    { user_uuid: userId }
  );

  if (!hasPremiumAccess) {
    return res.status(403).json({
      success: false,
      message: "Premium subscription required to create bids",
      requires_subscription: true, // Frontend flag
    });
  }
}
```

**Frontend Response:**
- **Status:** `403 Forbidden`
- **Flag:** `requires_subscription: true`
- **Action:** Show subscription upgrade modal

### 2. **Campaign Creation** (`POST /api/campaigns`)

**Backend Check:**
```javascript
// Check subscription status for brand owners
if (req.user.role === "brand_owner") {
  const { data: hasPremiumAccess } = await supabaseAdmin.rpc(
    "has_active_premium_subscription",
    { user_uuid: userId }
  );

  if (!hasPremiumAccess) {
    return res.status(403).json({
      success: false,
      message: "Premium subscription required to create campaigns",
      requires_subscription: true, // Frontend flag
    });
  }
}
```

**Frontend Response:**
- **Status:** `403 Forbidden`
- **Flag:** `requires_subscription: true`
- **Action:** Show subscription upgrade modal

### 3. **User Search** (`GET /api/users`)

**Backend Check:**
```javascript
// Check if user has active premium subscription (only for brand owners)
let hasPremiumAccess = false;
if (userRole === 'brand_owner') {
  const { data: subscriptionStatus } = await supabaseAdmin.rpc(
    'has_active_premium_subscription',
    { user_uuid: userId }
  );
  hasPremiumAccess = subscriptionStatus;
}

// Build query based on subscription status
let selectFields = `
  id, phone, role, languages, categories, 
  min_range, max_range, created_at, social_platforms (*)
`;

// Add name and email only for premium users or non-brand owners
if (hasPremiumAccess || userRole !== 'brand_owner') {
  selectFields = `
    id, phone, name, email, role, languages, categories,
    min_range, max_range, created_at, social_platforms (*)
  `;
}
```

**Frontend Response:**
- **Premium Users:** Full user data (name, email, phone)
- **Non-Premium Brand Owners:** Limited data (masked phone, no name/email)
- **Flag:** `requires_subscription: userRole === 'brand_owner' && !hasPremiumAccess`

---

## 📱 Frontend Subscription Handling

### 1. **API Response Interceptor**

```typescript
// Global API response interceptor
const apiResponseInterceptor = (response: Response) => {
  if (response.status === 403) {
    return response.json().then(data => {
      if (data.requires_subscription) {
        // Handle subscription requirement
        handleSubscriptionRequired(data);
        throw new SubscriptionRequiredError(data.message);
      }
      throw new ForbiddenError(data.message);
    });
  }
  return response.json();
};

// Custom error classes
class SubscriptionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionRequiredError';
  }
}

class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
```

### 2. **Subscription Status Hook**

```typescript
import { useState, useEffect } from 'react';

interface SubscriptionStatus {
  has_active_subscription: boolean;
  subscription: {
    id: string;
    plan_id: string;
    plan_name: string;
    status: string;
    start_date: string;
    end_date: string;
    amount_paid: number;
  } | null;
}

const useSubscriptionStatus = (userId: string) => {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubscriptionStatus = async () => {
      try {
        const response = await fetch(`/api/users/${userId}/subscription-status`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setSubscriptionStatus(data.data);
        } else {
          setError('Failed to fetch subscription status');
        }
      } catch (err) {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchSubscriptionStatus();
    }
  }, [userId]);

  return { subscriptionStatus, loading, error };
};
```

### 3. **Subscription Required Modal**

```typescript
import React, { useState } from 'react';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: (planId: string) => void;
  requiredFeature: string;
}

const SubscriptionRequiredModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  onUpgrade,
  requiredFeature
}) => {
  const [selectedPlan, setSelectedPlan] = useState<string>('1month');

  if (!isOpen) return null;

  return (
    <div className="subscription-modal-overlay">
      <div className="subscription-modal">
        <div className="modal-header">
          <h2>Premium Subscription Required</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        <div className="modal-content">
          <p>
            To {requiredFeature}, you need an active premium subscription.
          </p>
          
          <div className="subscription-plans">
            <h3>Choose a Plan</h3>
            <div className="plans-grid">
              <div className="plan-card">
                <h4>1 Month</h4>
                <p className="price">₹499</p>
                <p className="period">per month</p>
                <button 
                  className={`plan-button ${selectedPlan === '1month' ? 'selected' : ''}`}
                  onClick={() => setSelectedPlan('1month')}
                >
                  Select
                </button>
              </div>
              
              <div className="plan-card highlight">
                <h4>1 Year</h4>
                <p className="price">₹4,999</p>
                <p className="period">per year</p>
                <p className="savings">Save ₹4,989</p>
                <button 
                  className={`plan-button ${selectedPlan === '1year' ? 'selected' : ''}`}
                  onClick={() => setSelectedPlan('1year')}
                >
                  Select
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            Cancel
          </button>
          <button 
            onClick={() => onUpgrade(selectedPlan)}
            className="upgrade-button"
          >
            Upgrade Now
          </button>
        </div>
      </div>
    </div>
  );
};
```

### 4. **Feature Access Control**

```typescript
// Component-level subscription check
const CreateBidButton: React.FC = () => {
  const { subscriptionStatus, loading } = useSubscriptionStatus(userId);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  const handleCreateBid = async () => {
    if (!subscriptionStatus?.has_active_subscription) {
      setShowSubscriptionModal(true);
      return;
    }

    // Proceed with bid creation
    try {
      const response = await fetch('/api/bids', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bidData)
      });

      if (response.status === 403) {
        const data = await response.json();
        if (data.requires_subscription) {
          setShowSubscriptionModal(true);
          return;
        }
      }

      // Handle successful creation
      const result = await response.json();
      if (result.success) {
        showSuccess('Bid created successfully!');
      }
    } catch (error) {
      showError('Failed to create bid');
    }
  };

  if (loading) {
    return <button disabled>Loading...</button>;
  }

  return (
    <>
      <button 
        onClick={handleCreateBid}
        className="create-bid-button"
        disabled={!subscriptionStatus?.has_active_subscription}
      >
        {subscriptionStatus?.has_active_subscription 
          ? 'Create New Bid' 
          : 'Premium Required'
        }
      </button>

      <SubscriptionRequiredModal
        isOpen={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
        onUpgrade={(planId) => {
          // Handle subscription upgrade
          window.location.href = `/subscription/upgrade?plan=${planId}`;
        }}
        requiredFeature="create bids"
      />
    </>
  );
};
```

### 5. **Conditional UI Rendering**

```typescript
// Show different content based on subscription status
const UserSearchResults: React.FC<{ users: User[] }> = ({ users }) => {
  const { subscriptionStatus } = useSubscriptionStatus(userId);
  const isPremium = subscriptionStatus?.has_active_subscription;

  return (
    <div className="user-search-results">
      {users.map(user => (
        <div key={user.id} className="user-card">
          <div className="user-info">
            {isPremium ? (
              // Premium users see full information
              <>
                <h3>{user.name}</h3>
                <p>{user.email}</p>
                <p>{user.phone}</p>
              </>
            ) : (
              // Non-premium users see limited information
              <>
                <h3>Influencer</h3>
                <p>Phone: {user.phone ? maskPhone(user.phone) : 'N/A'}</p>
                <div className="upgrade-prompt">
                  <p>Upgrade to see full contact information</p>
                  <button onClick={() => showSubscriptionModal()}>
                    Upgrade Now
                  </button>
                </div>
              </>
            )}
          </div>
          
          <div className="user-stats">
            <span>Languages: {user.languages?.join(', ')}</span>
            <span>Categories: {user.categories?.join(', ')}</span>
            <span>Range: ₹{user.min_range} - ₹{user.max_range}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// Helper function to mask phone numbers
const maskPhone = (phone: string): string => {
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
};
```

---

## 🚨 Error Handling Patterns

### 1. **Global Error Handler**

```typescript
// Global error boundary for subscription-related errors
class SubscriptionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    if (error.name === 'SubscriptionRequiredError') {
      return { hasError: true, error };
    }
    return { hasError: false, error: null };
  }

  componentDidCatch(error, errorInfo) {
    if (error.name === 'SubscriptionRequiredError') {
      // Log subscription requirement
      console.log('Subscription required:', error.message);
    }
  }

  render() {
    if (this.state.hasError && this.state.error?.name === 'SubscriptionRequiredError') {
      return (
        <SubscriptionRequiredModal
          isOpen={true}
          onClose={() => this.setState({ hasError: false })}
          onUpgrade={(planId) => {
            window.location.href = `/subscription/upgrade?plan=${planId}`;
          }}
          requiredFeature="access this feature"
        />
      );
    }

    return this.props.children;
  }
}
```

### 2. **API Call Wrapper**

```typescript
// Wrapper for API calls that handles subscription errors
const apiCall = async (url: string, options: RequestInit = {}) => {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 403) {
      const data = await response.json();
      
      if (data.requires_subscription) {
        // Trigger subscription modal
        window.dispatchEvent(new CustomEvent('subscription-required', {
          detail: { message: data.message }
        }));
        throw new SubscriptionRequiredError(data.message);
      }
      
      throw new ForbiddenError(data.message);
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'SubscriptionRequiredError') {
      throw error; // Re-throw to be handled by error boundary
    }
    
    // Handle other errors
    console.error('API call failed:', error);
    throw error;
  }
};
```

---

## 🔄 Subscription Status Updates

### 1. **Real-time Updates**

```typescript
// Listen for subscription status changes
useEffect(() => {
  const handleSubscriptionUpdate = (event: CustomEvent) => {
    const { subscriptionStatus } = event.detail;
    setSubscriptionStatus(subscriptionStatus);
  };

  window.addEventListener('subscription-updated', handleSubscriptionUpdate);
  
  return () => {
    window.removeEventListener('subscription-updated', handleSubscriptionUpdate);
  };
}, []);
```

### 2. **Polling for Status Changes**

```typescript
// Poll subscription status when user returns to app
useEffect(() => {
  const pollSubscriptionStatus = () => {
    fetchSubscriptionStatus();
  };

  // Poll when app becomes visible
  const handleVisibilityChange = () => {
    if (!document.hidden) {
      pollSubscriptionStatus();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, []);
```

---

## 📊 Subscription Analytics

### 1. **Track Subscription Events**

```typescript
// Track subscription-related user actions
const trackSubscriptionEvent = (event: string, data?: any) => {
  // Google Analytics
  if (window.gtag) {
    window.gtag('event', event, {
      event_category: 'subscription',
      ...data
    });
  }

  // Mixpanel
  if (window.mixpanel) {
    window.mixpanel.track(event, {
      category: 'subscription',
      ...data
    });
  }
};

// Usage examples
trackSubscriptionEvent('subscription_required_shown', {
  feature: 'create_bid',
  user_role: 'brand_owner'
});

trackSubscriptionEvent('subscription_upgrade_clicked', {
  plan_id: '1month',
  source: 'modal'
});
```

### 2. **Monitor Feature Usage**

```typescript
// Track feature access attempts
const trackFeatureAccess = (feature: string, hasAccess: boolean) => {
  trackSubscriptionEvent('feature_access_attempt', {
    feature,
    has_access: hasAccess,
    user_role: currentUser.role
  });
};

// Usage in components
const handleFeatureAction = (feature: string) => {
  const hasAccess = subscriptionStatus?.has_active_subscription;
  trackFeatureAccess(feature, hasAccess);
  
  if (!hasAccess) {
    showSubscriptionModal();
    return;
  }
  
  // Proceed with feature
};
```

---

## 🎯 Best Practices

### 1. **User Experience**
- **Clear Messaging:** Explain why subscription is required
- **Easy Upgrade:** Provide direct path to subscription page
- **Feature Preview:** Show what premium features unlock
- **Graceful Degradation:** Hide premium features for non-subscribers

### 2. **Performance**
- **Lazy Loading:** Only check subscription when needed
- **Caching:** Cache subscription status locally
- **Background Updates:** Update status in background
- **Optimistic UI:** Show premium features if recently verified

### 3. **Security**
- **Server Validation:** Always validate on backend
- **Token Refresh:** Handle expired tokens gracefully
- **Rate Limiting:** Prevent abuse of subscription checks
- **Audit Logging:** Log subscription-related actions

---

## 📚 Summary

The subscription system works as follows:

1. **Backend Checks:** Routes check subscription status using database functions
2. **Response Flags:** API returns `requires_subscription: true` when needed
3. **Frontend Handling:** Components show subscription modals and upgrade prompts
4. **Real-time Updates:** WebSocket and polling keep status current
5. **Error Boundaries:** Global error handling for subscription requirements

**Key Frontend Responsibilities:**
- ✅ **Intercept API responses** for subscription requirements
- ✅ **Show upgrade modals** when features are locked
- ✅ **Conditionally render UI** based on subscription status
- ✅ **Handle subscription updates** in real-time
- ✅ **Track user behavior** for analytics

**Key Backend Responsibilities:**
- ✅ **Validate subscription status** at route level
- ✅ **Return clear error messages** with subscription flags
- ✅ **Provide subscription status** via dedicated endpoints
- ✅ **Enforce access control** based on subscription level

The system ensures that premium features are properly protected while providing a smooth upgrade experience for users.
