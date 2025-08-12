# Railway Deployment Guide for Stoory Backend

## Overview
This guide helps you deploy the Stoory Backend to Railway and troubleshoot common issues, especially with WhatsApp OTP functionality.

## Prerequisites
- Railway account
- Facebook Developer account with WhatsApp Business API access
- Supabase project

## Deployment Steps

### 1. Connect to Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init
```

### 2. Environment Variables Setup
Set these environment variables in Railway dashboard:

#### Required Variables:
```
NODE_ENV=production
PORT=3000

# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# CORS Configuration (update with your frontend URLs)
CORS_ORIGIN=https://your-frontend-domain.com

# WhatsApp Configuration
WHATSAPP_SERVICE=custom
WHATSAPP_API_ENDPOINT=https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages
WHATSAPP_API_KEY=your_facebook_graph_api_access_token_here
WHATSAPP_TEMPLATE_NAME=your_otp_template_name

# Railway-specific WhatsApp configurations
WHATSAPP_TIMEOUT=30000
WHATSAPP_RETRY_ATTEMPTS=3
WHATSAPP_RETRY_DELAY=1000

# Payment Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

### 3. Deploy
```bash
railway up
```

**Note**: If you encounter Nixpacks build errors, the project now includes a Dockerfile that will be used automatically. The `railway.json` configuration specifies the Docker builder to avoid Nixpacks issues.

## Build and Deployment Issues

### Nixpacks Build Errors

**Problem**: `nix-env -if .nixpacks/nixpkgs-*.nix` fails during build

**Solution**: The project now uses Docker instead of Nixpacks
- Dockerfile is included in the project
- `railway.json` is configured to use `dockerfile` builder
- This bypasses Nixpacks entirely

**If you still encounter issues**:
```bash
# Force Railway to use Docker
railway up --build-builder dockerfile
```

## WhatsApp OTP Troubleshooting

### Common Issues and Solutions

#### 1. Facebook Graph API Connection Issues

**Problem**: `ECONNREFUSED` or `ENOTFOUND` errors when calling `graph.facebook.com`

**Solutions**:
- **Check Network Access**: Railway may have network restrictions
- **Use HTTPS**: Ensure your endpoint uses `https://` not `http://`
- **Verify Endpoint**: Double-check your Facebook Graph API endpoint
- **Check API Key**: Ensure your Facebook access token is valid and has proper permissions

**Debug Steps**:
```bash
# Test connectivity from Railway
curl -X GET "https://graph.facebook.com/v18.0/me?access_token=YOUR_TOKEN"
```

#### 2. Timeout Issues

**Problem**: Requests to Facebook Graph API timeout

**Solutions**:
- Increase timeout: Set `WHATSAPP_TIMEOUT=60000` (60 seconds)
- Enable retries: The service now automatically retries failed requests
- Check Facebook API status: Visit https://developers.facebook.com/status/

#### 3. Template Issues

**Problem**: Template not found or invalid

**Solutions**:
- Verify template name in Facebook Business Manager
- Ensure template is approved and active
- Check template parameters match your code

#### 4. Phone Number Format Issues

**Problem**: Invalid phone number format

**Solutions**:
- Ensure phone numbers include country code
- Remove special characters except `+`
- Test with verified phone numbers in Facebook Business Manager

### Railway-Specific Optimizations

The updated WhatsApp service includes:

1. **Retry Mechanism**: Automatically retries failed requests
2. **Timeout Configuration**: Configurable request timeouts
3. **Better Error Handling**: Detailed error messages for debugging
4. **Network Optimizations**: Railway-specific axios configurations

### Testing WhatsApp in Railway

#### 1. Use Console Mode for Testing
Set `WHATSAPP_SERVICE=console` to test without actual WhatsApp API calls.

#### 2. Test with Mock Phone Number
Use the mock phone number `9876543210` with OTP `123456` for testing.

#### 3. Monitor Logs
```bash
railway logs
```

### Environment-Specific Configurations

#### Development vs Production
```bash
# Development (local)
WHATSAPP_SERVICE=console
NODE_ENV=development

# Production (Railway)
WHATSAPP_SERVICE=custom
NODE_ENV=production
WHATSAPP_TIMEOUT=30000
WHATSAPP_RETRY_ATTEMPTS=3
```

#### Facebook Graph API Endpoint Format
```
# Correct format for Railway
WHATSAPP_API_ENDPOINT=https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages

# Replace YOUR_PHONE_NUMBER_ID with your actual phone number ID from Facebook
```

### Health Check Endpoint

Railway automatically uses the `/health` endpoint for health checks:

```json
{
  "success": true,
  "message": "Stoory Backend is running",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "production"
}
```

### Monitoring and Debugging

#### 1. Check Service Status
```bash
# Get service status
railway status

# View logs
railway logs --tail
```

#### 2. Test WhatsApp Service
```bash
# Test the health endpoint
curl https://your-railway-app.railway.app/health

# Test WhatsApp service (if console mode)
curl -X POST https://your-railway-app.railway.app/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9876543210"}'
```

#### 3. Debug WhatsApp Issues
The service now provides detailed error information:

```json
{
  "success": false,
  "message": "Failed to send OTP via Facebook Graph API",
  "error": {
    "code": "TIMEOUT",
    "timeout": 30000
  },
  "debug": {
    "endpoint": "https://graph.facebook.com/v18.0/...",
    "timeout": 30000,
    "retryAttempts": 3
  }
}
```

### Alternative Solutions

If Facebook Graph API continues to have issues in Railway:

#### 1. Use Alternative WhatsApp Providers
- Twilio WhatsApp API
- MessageBird WhatsApp API
- 360dialog WhatsApp API

#### 2. Implement Fallback Mechanism
The service supports multiple providers - you can implement a fallback system.

#### 3. Use SMS as Backup
Implement SMS OTP as a backup when WhatsApp fails.

## Support

If you continue to experience issues:

1. Check Railway's status page
2. Verify Facebook Graph API status
3. Review Railway logs for detailed error messages
4. Test with console mode to isolate the issue
5. Contact Railway support if it's a platform-specific issue
