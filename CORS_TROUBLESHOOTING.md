# CORS Troubleshooting Guide

## 🚨 **CORS Error Explanation**

The error you're seeing:
```
Access to fetch at 'http://10.10.7.127:3000/api/auth/send-otp' from origin 'http://localhost:8080' has been blocked by CORS policy
```

This happens when your frontend (running on `http://localhost:8080`) tries to make a request to your backend (running on `http://10.10.7.127:3000`), but the backend's CORS configuration doesn't allow this origin.

## 🔧 **What I Fixed**

### 1. **Enhanced CORS Configuration**
- Updated `middleware/security.js` with better CORS handling
- Added explicit support for `http://localhost:8080`
- Added proper regex patterns for local network IPs
- Added debugging logs to see blocked origins

### 2. **Added Debug Endpoints**
- `GET /cors-debug` - Test CORS before security middleware
- `GET /api/cors-test` - Test CORS after security middleware

## 🧪 **Testing CORS Fix**

### **Step 1: Test Basic CORS**
```bash
# Test from your frontend or browser console
fetch('http://10.10.7.127:3000/cors-debug')
  .then(response => response.json())
  .then(data => console.log(data));
```

### **Step 2: Test API CORS**
```bash
# Test API endpoint
fetch('http://10.10.7.127:3000/api/cors-test')
  .then(response => response.json())
  .then(data => console.log(data));
```

### **Step 3: Test Your Actual Endpoint**
```bash
# Test the actual endpoint that was failing
fetch('http://10.10.7.127:3000/api/auth/send-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phone: '+919999999999'
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

## 🔍 **Debugging Steps**

### **1. Check Backend Logs**
Look for these messages in your backend console:
- `CORS blocked origin: <origin>` - Shows which origins are being blocked
- `🚀 [DEBUG] Request received: <method> <url>` - Shows if requests are reaching the backend

### **2. Check Network Tab**
In your browser's Developer Tools:
1. Open Network tab
2. Make the request
3. Look for the failed request
4. Check the Response Headers for CORS headers

### **3. Test with curl**
```bash
# Test with curl (no CORS issues)
curl -X POST http://10.10.7.127:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919999999999"}'
```

## 🛠️ **Common Solutions**

### **Solution 1: Restart Backend**
After the CORS changes, restart your backend server:
```bash
# Stop the server (Ctrl+C) and restart
npm start
# or
node index.js
```

### **Solution 2: Check Environment Variables**
Make sure you don't have `CORS_ORIGIN` set in your environment:
```bash
# Check if CORS_ORIGIN is set
echo $CORS_ORIGIN
```

### **Solution 3: Use Localhost Instead**
If the IP address is causing issues, try using localhost:
```javascript
// In your frontend, change the API URL to:
const API_BASE_URL = 'http://localhost:3000';
```

### **Solution 4: Add Your Origin to Environment**
If you need to use the IP address, set the CORS_ORIGIN environment variable:
```bash
export CORS_ORIGIN="http://localhost:8080,http://10.10.7.127:3000"
```

## 📋 **Current CORS Configuration**

The backend now allows these origins:
- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:5173`
- `http://localhost:8080` ✅ **Your frontend**
- `http://localhost:8081`
- Any IP in `192.168.x.x` range
- Any IP in `10.x.x.x` range
- Any IP in `172.16-31.x.x` range

## 🚀 **Quick Fix**

1. **Restart your backend server**
2. **Test the CORS debug endpoint** from your frontend
3. **If that works, test your actual API call**

## 📞 **Still Having Issues?**

If you're still getting CORS errors:

1. **Check the backend console** for "CORS blocked origin" messages
2. **Try the debug endpoints** to see if CORS is working at all
3. **Check if your frontend is making preflight requests** (OPTIONS method)
4. **Verify the exact origin** your frontend is sending

The enhanced CORS configuration should now properly handle your `http://localhost:8080` origin!
