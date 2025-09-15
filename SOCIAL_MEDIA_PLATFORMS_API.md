# Social Media Platforms API Documentation

## Overview
This API allows users to manage their social media platform profiles after registration. Users can add, update, delete, and view their social media platforms.

## Base URL
```
/api/social-platforms
```

## Authentication
All endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get User's Social Media Platforms
**GET** `/api/social-platforms`

Get all social media platforms for the authenticated user.

**Response:**
```json
{
  "success": true,
  "platforms": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "platform_name": "Instagram",
      "profile_link": "https://instagram.com/username",
      "followers_count": 10000,
      "engagement_rate": 3.5,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### 2. Add Social Media Platform
**POST** `/api/social-platforms`

Add a new social media platform for the authenticated user.

**Request Body:**
```json
{
  "platform_name": "Instagram",
  "profile_link": "https://instagram.com/username",
  "followers_count": 10000,
  "engagement_rate": 3.5
}
```

**Validation:**
- `platform_name`: Required, 2-50 characters
- `profile_link`: Optional, valid URL
- `followers_count`: Optional, non-negative integer
- `engagement_rate`: Optional, 0-100 decimal

**Response:**
```json
{
  "success": true,
  "platform": {
    "id": "uuid",
    "user_id": "uuid",
    "platform_name": "Instagram",
    "profile_link": "https://instagram.com/username",
    "followers_count": 10000,
    "engagement_rate": 3.5,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z"
  },
  "message": "Social platform added successfully"
}
```

### 3. Update Social Media Platform
**PUT** `/api/social-platforms/:id`

Update an existing social media platform.

**Path Parameters:**
- `id`: Platform UUID

**Request Body:**
```json
{
  "platform_name": "Instagram",
  "profile_link": "https://instagram.com/newusername",
  "followers_count": 15000,
  "engagement_rate": 4.2
}
```

**Validation:**
- All fields are optional
- Same validation rules as POST

**Response:**
```json
{
  "success": true,
  "platform": {
    "id": "uuid",
    "user_id": "uuid",
    "platform_name": "Instagram",
    "profile_link": "https://instagram.com/newusername",
    "followers_count": 15000,
    "engagement_rate": 4.2,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z"
  },
  "message": "Social platform updated successfully"
}
```

### 4. Delete Social Media Platform
**DELETE** `/api/social-platforms/:id`

Delete a social media platform.

**Path Parameters:**
- `id`: Platform UUID

**Response:**
```json
{
  "success": true,
  "message": "Social platform deleted successfully"
}
```

### 5. Get Social Platform Statistics
**GET** `/api/social-platforms/stats`

Get aggregated statistics for all user's social media platforms.

**Response:**
```json
{
  "success": true,
  "stats": {
    "total_platforms": 3,
    "total_followers": 50000,
    "average_engagement": 3.8,
    "platforms": [
      {
        "platform_name": "Instagram",
        "followers_count": 20000,
        "engagement_rate": 4.2
      },
      {
        "platform_name": "YouTube",
        "followers_count": 30000,
        "engagement_rate": 3.4
      }
    ]
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Platform name already exists for this user"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Social platform not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error"
}
```

## Integration with Registration Flow

### Current Registration Flow
1. User requests OTP via `/api/auth/send-registration-otp`
2. User verifies OTP via `/api/auth/verify-otp`
3. User profile is created with basic information
4. User can then add social media platforms via `/api/social-platforms`

### Profile Retrieval
When fetching user profile via `/api/auth/profile`, social media platforms are included:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "phone": "+1234567890",
    "role": "influencer",
    "social_platforms": [
      {
        "id": "uuid",
        "platform_name": "Instagram",
        "profile_link": "https://instagram.com/username",
        "followers_count": 10000,
        "engagement_rate": 3.5
      }
    ]
  }
}
```

## Database Schema

### social_platforms table
```sql
CREATE TABLE social_platforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform_name TEXT NOT NULL,
    profile_link TEXT,
    followers_count INTEGER,
    engagement_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Security

- All endpoints require authentication
- Users can only manage their own social media platforms
- Platform names must be unique per user
- Input validation prevents SQL injection and XSS attacks
