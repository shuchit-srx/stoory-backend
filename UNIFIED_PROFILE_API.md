# Unified Profile API - `/api/auth/profile`

All user profile data (including verification) is now handled through the single `/api/auth/profile` endpoint.

## 📋 **Available Endpoints**

### **1. Get Profile**
```http
GET /api/auth/profile
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "role": "influencer",
    "gender": "male",
    "date_of_birth": "1995-01-01",
    "profile_image_url": "https://storage.url/profile.jpg",
    "pan_number": "ABCDE1234F",
    "verification_status": "pending",
    "is_verified": false,
    "verification_profile": { /* verification data */ },
    "social_platforms": [/* social platforms */]
  }
}
```

### **2. Update Profile (All Fields)**
```http
PUT /api/auth/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "date_of_birth": "1995-01-01",
  "gender": "male",
  "pan_number": "ABCDE1234F",
  "verification_profile": {
    "current_step": "document_upload",
    "steps_completed": ["basic_info"],
    "additional_data": {}
  }
}
```

### **3. Upload Profile Image**
```http
POST /api/auth/profile/image
Authorization: Bearer <token>
Content-Type: multipart/form-data

Form Data:
- image: [file]
```

### **4. Upload Verification Document**
```http
POST /api/auth/profile/verification-document
Authorization: Bearer <token>
Content-Type: multipart/form-data

Form Data:
- verification_document: [file]
- document_type: "pan_card" | "aadhaar_card" | "passport" | "driving_license" | "voter_id"
```

## 🎯 **Frontend Usage**

### **Complete Profile Update Example:**
```javascript
// Update all user data in one request
const updateUserProfile = async (profileData) => {
  try {
    const response = await axios.put('/api/auth/profile', {
      // Basic info
      name: profileData.name,
      email: profileData.email,
      date_of_birth: profileData.dateOfBirth,
      gender: profileData.gender,
      
      // Verification data
      pan_number: profileData.panNumber,
      verification_profile: {
        current_step: "document_upload",
        steps_completed: ["basic_info", "personal_details"],
        document_uploaded: false,
        additional_data: profileData.verificationData
      }
    }, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Profile update failed:', error);
    throw error;
  }
};
```

### **Upload Verification Document:**
```javascript
const uploadVerificationDocument = async (file, documentType) => {
  try {
    const formData = new FormData();
    formData.append('verification_document', file);
    formData.append('document_type', documentType);

    const response = await axios.post('/api/auth/profile/verification-document', formData, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'multipart/form-data'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Document upload failed:', error);
    throw error;
  }
};
```

## ✅ **Benefits of Unified API**

1. **Single Endpoint** - All profile data handled in one place
2. **Consistent Validation** - Same validation rules for all fields
3. **Simplified Frontend** - No need to remember multiple endpoints
4. **Better Error Handling** - Consistent error responses
5. **Atomic Updates** - All fields updated in single transaction

## 🔧 **Database Migration**

Before using the new fields, run the migration:

```bash
psql -d your_database -f database/add_essential_user_fields.sql
```

This adds:
- `date_of_birth` (fixes the current error)
- `pan_number`, `verification_image_url`, `verification_document_type`
- `verification_status`, `is_verified`
- `verification_profile` (JSONB for flexible verification data)

## 🚨 **Important Notes**

- **All fields are optional** - Update only what you need
- **Validation is automatic** - Invalid data will be rejected with clear error messages
- **Profile image** uses `profile_image_url` field (not `avatar`)
- **Verification documents** are stored separately from profile images
- **verification_profile** is hidden from regular profile views but stored for registration flow

This unified approach makes the API much simpler and more maintainable!
