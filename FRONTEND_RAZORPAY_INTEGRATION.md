# Frontend RazorPay Integration Guide

## Overview
This guide shows how to integrate RazorPay payment gateway with the Stoory subscription system on the frontend.

## Prerequisites
1. Include RazorPay SDK in your HTML:
```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

## Complete Integration Flow

### Step 1: Display Plans and Get Payment Config

```javascript
// Get available plans
async function loadPlans() {
    try {
        const response = await fetch('/api/subscriptions/plans');
        const data = await response.json();
        
        if (data.success) {
            displayPlans(data.plans);
        }
    } catch (error) {
        console.error('Error loading plans:', error);
    }
}

// Get payment configuration
async function getPaymentConfig() {
    try {
        const response = await fetch('/api/subscriptions/payment-config');
        const data = await response.json();
        
        if (data.success) {
            return data.config;
        }
    } catch (error) {
        console.error('Error getting payment config:', error);
    }
}

// Display plans in UI
function displayPlans(plans) {
    const plansContainer = document.getElementById('plans-container');
    plansContainer.innerHTML = '';
    
    plans.forEach(plan => {
        const planCard = `
            <div class="plan-card ${plan.highlight ? 'highlighted' : ''}">
                <h3>${plan.name}</h3>
                <div class="price">₹${plan.price}</div>
                <div class="period">${plan.period}</div>
                <p>${plan.description}</p>
                <button onclick="selectPlan('${plan.id}')" class="select-plan-btn">
                    Select Plan
                </button>
            </div>
        `;
        plansContainer.innerHTML += planCard;
    });
}
```

### Step 2: Create Order and Initialize RazorPay

```javascript
// Handle plan selection
async function selectPlan(planId) {
    try {
        // Show loading state
        showLoading('Creating order...');
        
        // Get payment configuration
        const paymentConfig = await getPaymentConfig();
        
        // Create order
        const orderResponse = await fetch('/api/subscriptions/create-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}` // Your auth token
            },
            body: JSON.stringify({ plan_id: planId })
        });
        
        const orderData = await orderResponse.json();
        
        if (orderData.success) {
            // Initialize RazorPay
            initializeRazorPay(orderData.order, paymentConfig);
        } else {
            showError(orderData.message);
        }
    } catch (error) {
        console.error('Error selecting plan:', error);
        showError('Failed to create order');
    } finally {
        hideLoading();
    }
}

// Initialize RazorPay checkout
function initializeRazorPay(order, config) {
    const options = {
        key: config.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'Stoory',
        description: 'Subscription Payment',
        order_id: order.id,
        handler: function (response) {
            // Handle successful payment
            processPayment(response);
        },
        prefill: {
            name: getUserName(), // Get from your user data
            email: getUserEmail(), // Get from your user data
            contact: getUserPhone() // Get from your user data
        },
        theme: {
            color: '#3399cc'
        },
        modal: {
            ondismiss: function() {
                console.log('Payment modal closed');
            }
        }
    };
    
    const rzp = new Razorpay(options);
    rzp.open();
}
```

### Step 3: Process Payment

```javascript
// Process payment after successful RazorPay payment
async function processPayment(paymentResponse) {
    try {
        showLoading('Processing payment...');
        
        const response = await fetch('/api/subscriptions/process-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                order_id: paymentResponse.razorpay_order_id,
                payment_id: paymentResponse.razorpay_payment_id,
                signature: paymentResponse.razorpay_signature
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Payment successful! Your subscription is now active.');
            updateSubscriptionStatus(data.subscription);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Error processing payment:', error);
        showError('Failed to process payment');
    } finally {
        hideLoading();
    }
}
```

### Step 4: Subscription Management

```javascript
// Get current subscription status
async function getSubscriptionStatus() {
    try {
        const response = await fetch('/api/subscriptions/status', {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateSubscriptionUI(data.subscription);
        }
    } catch (error) {
        console.error('Error getting subscription status:', error);
    }
}

// Update subscription UI
function updateSubscriptionUI(subscriptionData) {
    const statusContainer = document.getElementById('subscription-status');
    
    if (subscriptionData.has_active_subscription) {
        const subscription = subscriptionData.subscription;
        statusContainer.innerHTML = `
            <div class="active-subscription">
                <h3>Active Subscription</h3>
                <p>Plan: ${subscription.plan_name}</p>
                <p>Status: ${subscription.status}</p>
                <p>Expires: ${new Date(subscription.end_date).toLocaleDateString()}</p>
                <button onclick="cancelSubscription()" class="cancel-btn">
                    Cancel Subscription
                </button>
            </div>
        `;
    } else {
        statusContainer.innerHTML = `
            <div class="no-subscription">
                <h3>No Active Subscription</h3>
                <p>Subscribe to access premium features</p>
                <button onclick="showPlans()" class="subscribe-btn">
                    View Plans
                </button>
            </div>
        `;
    }
}

// Cancel subscription
async function cancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription?')) {
        return;
    }
    
    try {
        showLoading('Cancelling subscription...');
        
        const response = await fetch('/api/subscriptions/cancel', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Subscription cancelled successfully');
            getSubscriptionStatus(); // Refresh status
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        showError('Failed to cancel subscription');
    } finally {
        hideLoading();
    }
}

// Get subscription history
async function getSubscriptionHistory(page = 1) {
    try {
        const response = await fetch(`/api/subscriptions/history?page=${page}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            displaySubscriptionHistory(data.subscriptions, data.pagination);
        }
    } catch (error) {
        console.error('Error getting subscription history:', error);
    }
}
```

### Step 5: Utility Functions

```javascript
// Helper functions for UI management
function showLoading(message) {
    // Implement loading indicator
    console.log('Loading:', message);
}

function hideLoading() {
    // Hide loading indicator
    console.log('Loading complete');
}

function showSuccess(message) {
    // Show success message
    alert('Success: ' + message);
}

function showError(message) {
    // Show error message
    alert('Error: ' + message);
}

// Helper functions for user data (implement based on your auth system)
function getAuthToken() {
    return localStorage.getItem('authToken'); // Or however you store auth token
}

function getUserName() {
    return localStorage.getItem('userName') || '';
}

function getUserEmail() {
    return localStorage.getItem('userEmail') || '';
}

function getUserPhone() {
    return localStorage.getItem('userPhone') || '';
}
```

## Complete HTML Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stoory Subscription</title>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
    <div id="app">
        <h1>Stoory Subscription Plans</h1>
        
        <!-- Subscription Status -->
        <div id="subscription-status"></div>
        
        <!-- Plans Container -->
        <div id="plans-container"></div>
        
        <!-- Subscription History -->
        <div id="subscription-history"></div>
    </div>

    <script>
        // Initialize the app
        document.addEventListener('DOMContentLoaded', function() {
            loadPlans();
            getSubscriptionStatus();
            getSubscriptionHistory();
        });
    </script>
</body>
</html>
```

## Key Points

1. **Authentication**: All protected endpoints require a valid JWT token in the Authorization header
2. **Error Handling**: Always handle API errors gracefully and show appropriate messages to users
3. **Loading States**: Show loading indicators during API calls for better UX
4. **Payment Verification**: The backend verifies all payments with RazorPay before processing
5. **Webhook Handling**: The backend automatically handles RazorPay webhooks for payment status updates
6. **Security**: Never expose RazorPay secret key on the frontend, only the public key

## Testing

For testing, use RazorPay test credentials:
- Test Card: 4111 1111 1111 1111
- Expiry: Any future date
- CVV: Any 3 digits
- OTP: 123456
