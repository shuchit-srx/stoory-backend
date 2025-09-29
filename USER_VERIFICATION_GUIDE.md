# User Verification System Guide

This guide explains the enhanced user verification system for influencers and brand owners, including the new fields and API endpoints.

## Overview

The verification system now includes comprehensive fields for both influencers and brand owners to ensure proper identity verification and business validation.

## New Database Fields

### User Verification Fields

#### Personal Information
- `pan_number` - PAN number for tax verification (format: AAAAA9999A)
- `verification_image_url` - URL of uploaded verification document
- `verification_document_type` - Type of document (pan_card, aadhaar_card, passport, driving_license, voter_id)
- `verification_status` - Current status (pending, under_review, verified, rejected)
- `is_verified` - Boolean flag for quick verification check
- `verification_priority` - Priority level (low, normal, high, urgent)
- `verification_notes` - Admin notes about verification
- `verified_at` - Timestamp when verified
- `verified_by` - Admin who verified the user

#### Address Information
- `address_line1` - Primary address line
- `address_line2` - Secondary address line
- `address_city` - City
- `address_state` - State
- `address_pincode` - 6-digit pincode
- `address_country` - Country (default: India)

#### Personal Details
- `date_of_birth` - Date of birth
- `bio` - User biography/description
- `experience_years` - Years of experience in field
- `specializations` - Array of specializations/skills
- `portfolio_links` - Array of portfolio/website links

#### Emergency Contact
- `emergency_contact_name` - Emergency contact person name
- `emergency_contact_phone` - Emergency contact phone
- `emergency_contact_relation` - Relationship with emergency contact

#### Business Information (Brand Owners)
- `business_name` - Business name
- `business_type` - Type of business entity (individual, partnership, private_limited, public_limited, llp, sole_proprietorship)
- `gst_number` - GST registration number
- `business_registration_number` - Business registration number
- `business_address` - Business address
- `business_website` - Business website URL

### Enhanced Social Media Fields

#### Additional Social Platform Data
- `platform_username` - Username/handle on platform
- `platform_display_name` - Display name on platform
- `platform_category` - Content category (fashion, tech, food, etc.)
- `platform_verified` - Whether platform account is verified
- `platform_metrics` - JSON object with platform-specific metrics
- `platform_audience_demographics` - JSON object with audience demographics
- `platform_content_categories` - Array of content categories posted
- `platform_posting_frequency` - How often content is posted
- `platform_engagement_metrics` - JSON object with engagement metrics
- `platform_contact_email` - Contact email for platform account
- `platform_contact_phone` - Contact phone for platform account
- `platform_website` - Website associated with platform account
- `platform_bio` - Bio/description on platform
- `platform_created_date` - Date when platform account was created
- `platform_is_primary` - Whether this is the primary platform
- `platform_is_active` - Whether platform account is currently active

## API Endpoints

### 1. Get User Profile
```
GET /api/users/profile
```
Returns complete user profile with verification details and completeness percentage.

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "role": "influencer",
    "verification_completeness": 75,
    "missing_verification_fields": ["pan_number", "verification_document"],
    "pan_number": "ABCDE1234F",
    "verification_status": "pending",
    "is_verified": false,
    // ... other fields
  }
}
```

### 2. Get Verification Status
```
GET /api/users/verification-status
```
Returns detailed verification status and missing fields.

**Response:**
```json
{
  "success": true,
  "verification": {
    "verification_status": "pending",
    "is_verified": false,
    "verification_completeness": 60,
    "missing_fields": ["pan_number", "address"],
    "social_platforms_count": 2,
    // ... other verification fields
  }
}
```

### 3. Update Verification Details
```
PUT /api/users/verification-details
Content-Type: application/json

{
  "pan_number": "ABCDE1234F",
  "address_line1": "123 Main Street",
  "address_city": "Mumbai",
  "address_state": "Maharashtra",
  "address_pincode": "400001",
  "bio": "Fashion influencer with 5 years experience",
  "experience_years": 5,
  "specializations": ["fashion", "lifestyle", "beauty"],
  "portfolio_links": ["https://instagram.com/username", "https://youtube.com/username"]
}
```

**Validation Rules:**
- PAN number: Must match format AAAAA9999A
- Address fields: Required lengths and formats
- Bio: 10-1000 characters
- Experience years: 0-50
- Specializations: Array of strings
- Portfolio links: Array of valid URLs

### 4. Upload Verification Document
```
POST /api/users/verification-document
Content-Type: multipart/form-data

document_type: "pan_card"
verification_document: [file]
```

**Supported Document Types:**
- `pan_card` - PAN card
- `aadhaar_card` - Aadhaar card
- `passport` - Passport
- `driving_license` - Driving license
- `voter_id` - Voter ID

**Response:**
```json
{
  "success": true,
  "message": "Verification document uploaded successfully",
  "verification_image_url": "https://storage.url/verification_document.jpg",
  "document_type": "pan_card"
}
```

## Registration Flow Updates

### For Influencers
During registration, influencers can now provide:
1. **Basic Info**: Name, email, phone, role
2. **Personal Details**: Gender, languages, categories, pricing range
3. **Verification Info**: PAN number, address, bio, experience
4. **Social Media**: Platform details with comprehensive metrics
5. **Portfolio**: Links to work samples and profiles

### For Brand Owners
During registration, brand owners can provide:
1. **Basic Info**: Name, email, phone, role
2. **Business Info**: Business name, type, GST number, registration details
3. **Verification Info**: PAN number, business address
4. **Contact Info**: Business website, contact details

## Verification Process

### 1. User Completes Profile
- Users fill out all available verification fields
- System calculates verification completeness percentage
- Missing fields are highlighted to guide users

### 2. Document Upload
- Users upload verification documents (PAN card, etc.)
- Documents are stored securely in Supabase Storage
- Document type is validated and recorded

### 3. Admin Review
- Admins can review verification status
- Verification status can be updated (pending → under_review → verified/rejected)
- Admin notes can be added for rejected applications

### 4. Verification Complete
- Once verified, `is_verified` flag is set to true
- `verified_at` timestamp is recorded
- `verified_by` admin is recorded

## Database Migration

To apply the new verification fields, run:

```sql
-- Run the migration script
\i database/add_user_verification_fields.sql
```

This will:
1. Add all new verification fields to the `users` table
2. Enhance the `social_platforms` table with additional fields
3. Create indexes for better performance
4. Add RLS policies for security
5. Create helper functions and views

## Validation Examples

### PAN Number Validation
```javascript
// Valid PAN numbers
"ABCDE1234F" ✅
"XYZAB5678C" ✅

// Invalid PAN numbers
"12345ABCDE" ❌ (starts with number)
"ABCDE123" ❌ (too short)
"ABCDE12345F" ❌ (too long)
```

### GST Number Validation
```javascript
// Valid GST numbers
"22ABCDE1234F1Z5" ✅

// Invalid GST numbers
"12ABCDE1234F1Z5" ❌ (invalid state code)
"22ABCDE1234F1Z" ❌ (missing last character)
```

### Address Validation
```javascript
// Valid addresses
{
  "address_line1": "123 Main Street, Apartment 4B",
  "address_city": "Mumbai",
  "address_state": "Maharashtra",
  "address_pincode": "400001",
  "address_country": "India"
}

// Invalid addresses
{
  "address_line1": "123", // Too short (min 5 chars)
  "address_pincode": "012345" // Starts with 0
}
```

## Security Considerations

1. **Document Storage**: Verification documents are stored securely in Supabase Storage
2. **Access Control**: Only users can view/update their own verification data
3. **Admin Controls**: Only admins can update verification status
4. **Data Validation**: All inputs are validated before storage
5. **RLS Policies**: Row-level security ensures data isolation

## Frontend Integration

### Registration Form Fields

#### For Influencers:
```jsx
// Basic Info
<Input name="name" required />
<Input name="email" type="email" required />
<Select name="role" value="influencer" disabled />

// Verification Info
<Input name="pan_number" pattern="[A-Z]{5}[0-9]{4}[A-Z]{1}" />
<TextArea name="bio" minLength={10} maxLength={1000} />
<Input name="experience_years" type="number" min={0} max={50} />

// Address
<Input name="address_line1" required />
<Input name="address_city" required />
<Input name="address_state" required />
<Input name="address_pincode" pattern="[1-9][0-9]{5}" required />

// Social Media
<SocialMediaForm platforms={['instagram', 'youtube', 'tiktok']} />
```

#### For Brand Owners:
```jsx
// Business Info
<Input name="business_name" required />
<Select name="business_type" options={businessTypes} required />
<Input name="gst_number" pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}" />
<Input name="business_website" type="url" />
```

### Verification Status Component
```jsx
const VerificationStatus = ({ user }) => {
  const completeness = user.verification_completeness;
  const missingFields = user.missing_verification_fields;
  
  return (
    <div className="verification-status">
      <div className="progress-bar">
        <div style={{ width: `${completeness}%` }} />
      </div>
      <p>Verification: {completeness}% complete</p>
      {missingFields.length > 0 && (
        <div className="missing-fields">
          <p>Missing: {missingFields.join(', ')}</p>
        </div>
      )}
    </div>
  );
};
```

## Error Handling

### Common Validation Errors
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "pan_number",
      "message": "PAN number must be in format: AAAAA9999A"
    },
    {
      "field": "address_pincode",
      "message": "Pincode must be 6 digits and not start with 0"
    }
  ]
}
```

### File Upload Errors
```json
{
  "success": false,
  "message": "Invalid document type",
  "error": "Document type must be one of: pan_card, aadhaar_card, passport, driving_license, voter_id"
}
```

## Testing

### Test Registration with New Fields
```javascript
// Test influencer registration
const influencerData = {
  name: "John Doe",
  email: "john@example.com",
  phone: "+1234567890",
  role: "influencer",
  pan_number: "ABCDE1234F",
  bio: "Fashion influencer with 5 years experience",
  experience_years: 5,
  specializations: ["fashion", "lifestyle"],
  address_line1: "123 Main Street",
  address_city: "Mumbai",
  address_state: "Maharashtra",
  address_pincode: "400001"
};

// Test brand owner registration
const brandOwnerData = {
  name: "Jane Smith",
  email: "jane@company.com",
  phone: "+1234567891",
  role: "brand_owner",
  business_name: "Fashion Brand Co.",
  business_type: "private_limited",
  gst_number: "22ABCDE1234F1Z5",
  business_website: "https://fashionbrand.com"
};
```

This comprehensive verification system ensures that both influencers and brand owners provide sufficient information for proper verification while maintaining security and data integrity.
