# Debug Upload Issues - Verification Images & Social Profiles

## 🔍 **Common Upload Issues & Solutions**

### **1. Verification Image Upload Issues**

#### **Problem: Database Schema Mismatch**
The verification upload might be failing because the database fields don't exist yet.

**Solution: Run the migration first**
```bash
psql -d your_database -f database/add_essential_user_fields.sql
```

#### **Problem: File Upload Validation**
The `validateVerificationDocument` middleware might be too strict.

**Current validation:**
```javascript
const validateVerificationDocument = [
  body("document_type")
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid document type"),
];
```

**Fixed validation:**
```javascript
const validateVerificationDocument = [
  body("document_type")
    .optional()
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid document type"),
];
```

### **2. Social Platform Upload Issues**

#### **Problem: Missing Required Fields**
The social platform controller expects specific field names that might not match the frontend.

**Current expected fields:**
- `platform_name` (required)
- `profile_link` (optional)
- `followers_count` (optional)
- `engagement_rate` (optional)

**But the database migration added:**
- `platform` (enum)
- `username` (required)
- `followers_count` (required)

### **3. Supabase Storage Issues**

#### **Problem: Storage Bucket Configuration**
The upload might fail if the storage bucket doesn't exist or has wrong permissions.

**Check:**
1. Storage bucket `images` exists in Supabase
2. RLS policies allow uploads
3. File size limits are appropriate

## 🛠️ **Complete Fix Implementation**

### **Step 1: Fix Social Platform Controller**

The social platform controller needs to be updated to match the new database schema.

### **Step 2: Add Better Error Handling**

Add comprehensive error logging to identify the exact failure point.

### **Step 3: Test Upload Endpoints**

Create test scripts to verify each upload endpoint works.

## 🚨 **Immediate Actions Needed**

1. **Run the database migration** to add missing fields
2. **Update social platform validation** to match new schema
3. **Add comprehensive error logging** to identify failures
4. **Test each upload endpoint** individually

## 📋 **Debug Checklist**

- [ ] Database migration applied successfully
- [ ] Storage bucket exists and has correct permissions
- [ ] File size limits are appropriate (5MB)
- [ ] MIME type validation is working
- [ ] Required fields match between frontend and backend
- [ ] Error messages are descriptive and helpful
