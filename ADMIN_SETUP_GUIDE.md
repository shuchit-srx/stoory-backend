# Admin Setup Guide

This guide explains how to set up and use admin functionality in your Stoory Backend application.

## 🚀 Quick Start

### 1. **Admin Login Credentials**

The system comes with a pre-configured admin user for testing:

- **Phone**: `+919999999999` or `9999999999`
- **OTP**: `123456`
- **Email**: `admin@stoory.com`
- **Role**: `admin`

### 2. **Admin Login**

Use the regular authentication flow - the system automatically recognizes admin role:

```bash
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phone": "+919999999999",
  "otp": "123456"
}
```

**How it works:**
- Admin is just a regular user with `role: "admin"` in the database
- JWT token contains the role information
- Middleware automatically grants admin permissions based on role
- No special admin endpoints needed - same authentication flow for all users

### 3. **Response Format**
```json
{
  "success": true,
  "user": {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Admin User",
    "email": "admin@stoory.com",
    "phone": "+919999999999",
    "role": "admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Key Points:**
- Same response format as regular user login
- Role is included in the user object
- JWT token contains role information for authorization
- Use this token in `Authorization: Bearer <token>` header for all API calls

## 🔧 Database Setup

### 1. **Seed Admin User**
Run the admin seeding script to create the admin user in your database:

```sql
-- Run this SQL script in your database
\i database/seed_admin_user.sql
```

### 2. **Verify Admin User**
Check if admin user was created successfully:

```sql
SELECT id, phone, name, email, role, is_verified 
FROM users 
WHERE role = 'admin';
```

## 🛡️ Admin Permissions

### **Full Access Endpoints**
As an admin, you have access to ALL endpoints in the system:

#### **User Management**
- ✅ View all users (`GET /api/users/influencers`)
- ✅ View any user profile
- ✅ Update any user profile
- ✅ Manage user verification status

#### **Campaign Management**
- ✅ Create campaigns (`POST /api/campaigns`)
- ✅ View all campaigns (`GET /api/campaigns`)
- ✅ Update any campaign (`PUT /api/campaigns/:id`)
- ✅ Delete any campaign (`DELETE /api/campaigns/:id`)
- ✅ View campaign statistics (`GET /api/campaigns/stats`)

#### **Bid Management**
- ✅ Create bids (`POST /api/bids`)
- ✅ View all bids (`GET /api/bids`)
- ✅ Update any bid (`PUT /api/bids/:id`)
- ✅ Delete any bid (`DELETE /api/bids/:id`)
- ✅ View bid statistics (`GET /api/bids/stats`)

#### **Request Management**
- ✅ View all requests (`GET /api/requests`)
- ✅ Update any request status (`PUT /api/requests/:id/status`)
- ✅ Process payments (`POST /api/requests/approval-payment`)
- ✅ Manage work submissions

#### **Payment & Wallet Management**
- ✅ View all transactions (`GET /api/payments/transactions`)
- ✅ Process refunds (`POST /api/payments/refund`)
- ✅ View wallet balances
- ✅ Manage escrow holds

#### **Message & Conversation Management**
- ✅ View all conversations (`GET /api/messages/conversations`)
- ✅ View all messages
- ✅ Manage conversation states
- ✅ Send system messages

#### **Subscription Management**
- ✅ View all subscriptions (`GET /api/subscriptions/history`)
- ✅ Manage subscription plans
- ✅ Process subscription payments
- ✅ Handle webhooks

#### **Coupon Management**
- ✅ View all coupons (`GET /api/coupons/admin/all`)
- ✅ Create coupons (`POST /api/coupons/admin/create`)
- ✅ Update coupons (`PUT /api/coupons/admin/:couponId`)
- ✅ Delete coupons (`DELETE /api/coupons/admin/:couponId`)
- ✅ View coupon statistics (`GET /api/coupons/admin/stats`)

#### **File & Attachment Management**
- ✅ View all attachments
- ✅ Delete any attachment
- ✅ Manage file storage

#### **FCM & Notifications**
- ✅ Send test notifications (`POST /api/fcm/test`)
- ✅ Cleanup inactive tokens (`POST /api/fcm/cleanup`)
- ✅ Manage push notifications

#### **System Management**
- ✅ Health checks (`GET /health`)
- ✅ Test endpoints (`GET /test-socket`, `GET /test-fcm`)
- ✅ System monitoring

## 🔐 Authentication & Authorization

### **Token Usage**
After successful admin login, use the `access_token` in all API requests:

```bash
Authorization: Bearer <access_token>
```

### **Token Refresh**
When the access token expires, use the refresh token:

```bash
POST /api/auth/refresh-token
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

### **Role Verification**
The system automatically verifies admin role for protected endpoints. You don't need to specify roles in requests - the middleware handles it.

## 📊 Admin Dashboard Features

### **User Management Dashboard**
- View all users with pagination
- Filter by role, verification status, registration date
- Search by name, email, phone
- Manage user verification
- View user profiles and social platforms

### **Campaign Management Dashboard**
- View all campaigns with statistics
- Filter by status, budget range, creation date
- Search campaigns by title or description
- Manage campaign status
- View campaign performance metrics

### **Bid Management Dashboard**
- View all bids with statistics
- Filter by status, budget range, creation date
- Search bids by title or description
- Manage bid status
- View bid performance metrics

### **Request Management Dashboard**
- View all requests with status tracking
- Filter by status, amount range, date
- Search by influencer or brand owner
- Process payments and approvals
- Manage work submissions

### **Payment Dashboard**
- View transaction history
- Filter by transaction type, amount, date
- Process refunds
- Monitor wallet balances
- View escrow holds

### **Analytics Dashboard**
- User registration trends
- Campaign performance metrics
- Payment statistics
- System usage analytics
- Error monitoring

## 🚨 Security Considerations

### **Admin Account Security**
1. **Change Default Credentials**: Update the admin phone number and email in production
2. **Strong Authentication**: Consider implementing 2FA for admin accounts
3. **Access Logging**: Monitor admin actions and API usage
4. **IP Restrictions**: Consider restricting admin access to specific IP addresses

### **Database Security**
1. **RLS Policies**: Admin role is properly handled in Row Level Security policies
2. **Audit Trail**: Consider adding audit logging for admin actions
3. **Backup**: Regular database backups for admin data

### **API Security**
1. **Rate Limiting**: Admin endpoints respect rate limiting
2. **Input Validation**: All admin inputs are validated
3. **Error Handling**: Secure error messages that don't leak sensitive information

## 🧪 Testing Admin Features

### **Test Admin Login**
```bash
# Test admin login (same as regular user login)
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919999999999", "otp": "123456"}'
```

### **Test Admin Endpoints**
```bash
# Test admin access to user management
curl -X GET http://localhost:3000/api/users/influencers \
  -H "Authorization: Bearer <admin_access_token>"

# Test admin access to campaigns
curl -X GET http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer <admin_access_token>"

# Test admin access to coupon management
curl -X GET http://localhost:3000/api/coupons/admin/all \
  -H "Authorization: Bearer <admin_access_token>"
```

### **Test Role Verification**
```bash
# This should fail for non-admin users
curl -X GET http://localhost:3000/api/coupons/admin/all \
  -H "Authorization: Bearer <non_admin_access_token>"
```

## 📝 Admin Panel Integration

### **Frontend Integration**
1. **Login Form**: Create admin login form with phone/OTP input
2. **Dashboard**: Build admin dashboard with role-based navigation
3. **Data Tables**: Implement paginated tables for users, campaigns, etc.
4. **Real-time Updates**: Use WebSocket for live data updates
5. **Charts**: Add analytics charts for system metrics

### **API Integration**
1. **Authentication**: Implement token-based authentication
2. **Error Handling**: Handle API errors gracefully
3. **Loading States**: Show loading indicators for API calls
4. **Pagination**: Implement pagination for large datasets
5. **Search & Filter**: Add search and filter functionality

## 🔄 Maintenance

### **Regular Tasks**
1. **Monitor System Health**: Check `/health` endpoint regularly
2. **Review User Activity**: Monitor user registrations and activity
3. **Check Error Logs**: Review system logs for errors
4. **Update Admin Credentials**: Change default admin credentials periodically
5. **Database Maintenance**: Regular database optimization and cleanup

### **Troubleshooting**
1. **Login Issues**: Check phone number format and OTP validity
2. **Permission Errors**: Verify admin role in database
3. **Token Issues**: Check token expiration and refresh logic
4. **API Errors**: Review error logs and API responses

## 📞 Support

For admin setup issues or questions:
1. Check the logs for error messages
2. Verify database connection and admin user creation
3. Test with the provided mock credentials
4. Review the API documentation for endpoint details

---

**Note**: This admin setup is designed for development and testing. For production deployment, ensure you:
- Change default admin credentials
- Implement proper security measures
- Set up monitoring and logging
- Follow security best practices
