# Profile Image Upload - Frontend Implementation Guide

## Overview

This guide explains how to implement profile image upload functionality in your frontend application. The backend provides three main endpoints for profile image management:

1. **Upload Profile Image** - `POST /api/auth/profile/image`
2. **Delete Profile Image** - `DELETE /api/auth/profile/image`
3. **Update Profile (with image)** - `PUT /api/auth/profile`

## Backend Logic

### Image Upload Process
1. **File Validation**: Only image files (JPEG, PNG, GIF, WebP, BMP, SVG) are allowed
2. **Size Limit**: Maximum 5MB per image
3. **Storage**: Images are stored in Supabase Storage under the `profiles/` folder
4. **Unique Naming**: Files are renamed with timestamp and random string to prevent conflicts
5. **Old Image Cleanup**: Previous profile images are automatically deleted when uploading a new one

### Database Schema
```sql
-- Users table now includes profile_image_url field
ALTER TABLE users ADD COLUMN profile_image_url TEXT;
```

## API Endpoints

### 1. Upload Profile Image
```http
POST /api/auth/profile/image
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form Data:
- image: File (required) - The image file to upload
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "profile_image_url": "https://your-supabase-url/storage/v1/object/public/images/profiles/1234567890_abc123.jpg",
    // ... other user fields
  },
  "message": "Profile image uploaded successfully"
}
```

### 2. Delete Profile Image
```http
DELETE /api/auth/profile/image
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
    "profile_image_url": null,
    // ... other user fields
  },
  "message": "Profile image deleted successfully"
}
```

### 3. Update Profile (with optional image)
```http
PUT /api/auth/profile
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form Data:
- name: string (optional)
- email: string (optional)
- image: File (optional) - New profile image
- // ... other profile fields
```

## Frontend Implementation Examples

### React/JavaScript Implementation

#### 1. Basic Image Upload Component

```jsx
import React, { useState, useRef } from 'react';

const ProfileImageUpload = ({ user, onImageUpdate }) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(user?.profile_image_url || null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }

      // Validate file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(file);

      // Upload image
      uploadImage(file);
    }
  };

  const uploadImage = async (file) => {
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/auth/profile/image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        setPreview(data.user.profile_image_url);
        onImageUpdate(data.user);
        alert('Profile image updated successfully!');
      } else {
        alert('Failed to upload image: ' + data.message);
        setPreview(user?.profile_image_url || null);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload image');
      setPreview(user?.profile_image_url || null);
    } finally {
      setUploading(false);
    }
  };

  const deleteImage = async () => {
    if (!user?.profile_image_url) return;

    if (!confirm('Are you sure you want to delete your profile image?')) {
      return;
    }

    setUploading(true);

    try {
      const response = await fetch('/api/auth/profile/image', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();

      if (data.success) {
        setPreview(null);
        onImageUpdate(data.user);
        alert('Profile image deleted successfully!');
      } else {
        alert('Failed to delete image: ' + data.message);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="profile-image-upload">
      <div className="image-container">
        {preview ? (
          <img 
            src={preview} 
            alt="Profile" 
            className="profile-image"
            style={{ width: '150px', height: '150px', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div className="placeholder" style={{ 
            width: '150px', 
            height: '150px', 
            borderRadius: '50%', 
            backgroundColor: '#f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            color: '#999'
          }}>
            👤
          </div>
        )}
      </div>

      <div className="upload-controls">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*"
          style={{ display: 'none' }}
        />
        
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="upload-btn"
        >
          {uploading ? 'Uploading...' : 'Upload Image'}
        </button>

        {preview && (
          <button 
            onClick={deleteImage}
            disabled={uploading}
            className="delete-btn"
            style={{ marginLeft: '10px', backgroundColor: '#dc3545', color: 'white' }}
          >
            Delete Image
          </button>
        )}
      </div>

      <div className="upload-info">
        <small>Supported formats: JPEG, PNG, GIF, WebP, BMP, SVG</small>
        <br />
        <small>Maximum file size: 5MB</small>
      </div>
    </div>
  );
};

export default ProfileImageUpload;
```

#### 2. Complete Profile Form with Image Upload

```jsx
import React, { useState, useEffect } from 'react';

const ProfileForm = () => {
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    // ... other fields
  });
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/auth/profile', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setUser(data.user);
        setFormData({
          name: data.user.name || '',
          email: data.user.email || '',
          // ... other fields
        });
        setImagePreview(data.user.profile_image_url);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }

      setImageFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const formDataToSend = new FormData();
      
      // Add form fields
      Object.keys(formData).forEach(key => {
        if (formData[key] !== null && formData[key] !== undefined) {
          formDataToSend.append(key, formData[key]);
        }
      });

      // Add image if selected
      if (imageFile) {
        formDataToSend.append('image', imageFile);
      }

      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formDataToSend
      });

      const data = await response.json();

      if (data.success) {
        setUser(data.user);
        setImageFile(null);
        alert('Profile updated successfully!');
      } else {
        alert('Failed to update profile: ' + data.message);
      }
    } catch (error) {
      console.error('Update error:', error);
      alert('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="profile-form">
      <div className="form-group">
        <label>Profile Image</label>
        <div className="image-upload-section">
          {imagePreview && (
            <img 
              src={imagePreview} 
              alt="Preview" 
              style={{ width: '100px', height: '100px', borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          <input
            type="file"
            onChange={handleImageChange}
            accept="image/*"
            className="image-input"
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="name">Name</label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          className="form-control"
        />
      </div>

      <div className="form-group">
        <label htmlFor="email">Email</label>
        <input
          type="email"
          id="email"
          name="email"
          value={formData.email}
          onChange={handleInputChange}
          className="form-control"
        />
      </div>

      {/* Add other form fields as needed */}

      <button 
        type="submit" 
        disabled={loading}
        className="submit-btn"
      >
        {loading ? 'Updating...' : 'Update Profile'}
      </button>
    </form>
  );
};

export default ProfileForm;
```

### Vue.js Implementation

```vue
<template>
  <div class="profile-image-upload">
    <div class="image-container">
      <img 
        v-if="imagePreview" 
        :src="imagePreview" 
        alt="Profile" 
        class="profile-image"
      />
      <div v-else class="placeholder">👤</div>
    </div>

    <div class="upload-controls">
      <input
        ref="fileInput"
        type="file"
        @change="handleFileSelect"
        accept="image/*"
        style="display: none"
      />
      
      <button @click="selectFile" :disabled="uploading">
        {{ uploading ? 'Uploading...' : 'Upload Image' }}
      </button>

      <button 
        v-if="imagePreview" 
        @click="deleteImage" 
        :disabled="uploading"
        class="delete-btn"
      >
        Delete Image
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ProfileImageUpload',
  props: {
    user: Object
  },
  data() {
    return {
      uploading: false,
      imagePreview: this.user?.profile_image_url || null
    }
  },
  methods: {
    selectFile() {
      this.$refs.fileInput.click();
    },

    async handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;

      // Validate file
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imagePreview = e.target.result;
      };
      reader.readAsDataURL(file);

      // Upload image
      await this.uploadImage(file);
    },

    async uploadImage(file) {
      this.uploading = true;
      
      try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/api/auth/profile/image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: formData
        });

        const data = await response.json();

        if (data.success) {
          this.imagePreview = data.user.profile_image_url;
          this.$emit('image-updated', data.user);
          alert('Profile image updated successfully!');
        } else {
          alert('Failed to upload image: ' + data.message);
          this.imagePreview = this.user?.profile_image_url || null;
        }
      } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload image');
        this.imagePreview = this.user?.profile_image_url || null;
      } finally {
        this.uploading = false;
      }
    },

    async deleteImage() {
      if (!this.user?.profile_image_url) return;

      if (!confirm('Are you sure you want to delete your profile image?')) {
        return;
      }

      this.uploading = true;

      try {
        const response = await fetch('/api/auth/profile/image', {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        const data = await response.json();

        if (data.success) {
          this.imagePreview = null;
          this.$emit('image-updated', data.user);
          alert('Profile image deleted successfully!');
        } else {
          alert('Failed to delete image: ' + data.message);
        }
      } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete image');
      } finally {
        this.uploading = false;
      }
    }
  }
}
</script>
```

### Angular Implementation

```typescript
// profile-image-upload.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Component({
  selector: 'app-profile-image-upload',
  template: `
    <div class="profile-image-upload">
      <div class="image-container">
        <img 
          *ngIf="imagePreview" 
          [src]="imagePreview" 
          alt="Profile" 
          class="profile-image"
        />
        <div *ngIf="!imagePreview" class="placeholder">👤</div>
      </div>

      <div class="upload-controls">
        <input
          #fileInput
          type="file"
          (change)="handleFileSelect($event)"
          accept="image/*"
          style="display: none"
        />
        
        <button (click)="selectFile()" [disabled]="uploading">
          {{ uploading ? 'Uploading...' : 'Upload Image' }}
        </button>

        <button 
          *ngIf="imagePreview" 
          (click)="deleteImage()" 
          [disabled]="uploading"
          class="delete-btn"
        >
          Delete Image
        </button>
      </div>
    </div>
  `
})
export class ProfileImageUploadComponent {
  @Input() user: any;
  @Output() imageUpdated = new EventEmitter<any>();

  uploading = false;
  imagePreview: string | null = null;

  constructor(private http: HttpClient) {
    this.imagePreview = this.user?.profile_image_url || null;
  }

  selectFile() {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fileInput.click();
  }

  async handleFileSelect(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.imagePreview = e.target.result;
    };
    reader.readAsDataURL(file);

    // Upload image
    await this.uploadImage(file);
  }

  async uploadImage(file: File) {
    this.uploading = true;
    
    try {
      const formData = new FormData();
      formData.append('image', file);

      const headers = new HttpHeaders({
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      });

      const response = await this.http.post('/api/auth/profile/image', formData, { headers }).toPromise();
      const data = response as any;

      if (data.success) {
        this.imagePreview = data.user.profile_image_url;
        this.imageUpdated.emit(data.user);
        alert('Profile image updated successfully!');
      } else {
        alert('Failed to upload image: ' + data.message);
        this.imagePreview = this.user?.profile_image_url || null;
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload image');
      this.imagePreview = this.user?.profile_image_url || null;
    } finally {
      this.uploading = false;
    }
  }

  async deleteImage() {
    if (!this.user?.profile_image_url) return;

    if (!confirm('Are you sure you want to delete your profile image?')) {
      return;
    }

    this.uploading = true;

    try {
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      });

      const response = await this.http.delete('/api/auth/profile/image', { headers }).toPromise();
      const data = response as any;

      if (data.success) {
        this.imagePreview = null;
        this.imageUpdated.emit(data.user);
        alert('Profile image deleted successfully!');
      } else {
        alert('Failed to delete image: ' + data.message);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete image');
    } finally {
      this.uploading = false;
    }
  }
}
```

## Error Handling

### Common Error Scenarios

1. **File Type Validation**
   ```javascript
   if (!file.type.startsWith('image/')) {
     throw new Error('Only image files are allowed');
   }
   ```

2. **File Size Validation**
   ```javascript
   if (file.size > 5 * 1024 * 1024) {
     throw new Error('File size must be less than 5MB');
   }
   ```

3. **Network Errors**
   ```javascript
   try {
     const response = await fetch('/api/auth/profile/image', options);
     if (!response.ok) {
       throw new Error(`HTTP error! status: ${response.status}`);
     }
   } catch (error) {
     console.error('Network error:', error);
     // Handle error appropriately
   }
   ```

4. **Authentication Errors**
   ```javascript
   if (response.status === 401) {
     // Redirect to login or refresh token
     localStorage.removeItem('token');
     window.location.href = '/login';
   }
   ```

## Best Practices

### 1. Image Optimization
- Compress images before upload
- Use appropriate image formats (WebP for modern browsers)
- Implement client-side resizing for large images

### 2. User Experience
- Show upload progress
- Provide immediate preview
- Handle loading states
- Show clear error messages

### 3. Security
- Always validate file types on client and server
- Implement proper authentication
- Use HTTPS for all requests

### 4. Performance
- Implement lazy loading for images
- Use appropriate image sizes
- Cache images when possible

## Testing

### Manual Testing Checklist
- [ ] Upload valid image files (JPEG, PNG, GIF, WebP)
- [ ] Reject invalid file types
- [ ] Reject files larger than 5MB
- [ ] Test image preview functionality
- [ ] Test image deletion
- [ ] Test error handling
- [ ] Test with different user roles
- [ ] Test network failure scenarios

### Automated Testing Example
```javascript
// Jest test example
describe('ProfileImageUpload', () => {
  test('should upload valid image file', async () => {
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    const mockResponse = { success: true, user: { profile_image_url: 'test-url' } };
    
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    });

    // Test upload functionality
    // Assert expected behavior
  });
});
```

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Ensure backend CORS is configured for your frontend domain
   - Check if preflight requests are handled

2. **File Upload Fails**
   - Check file size and type validation
   - Verify authentication token
   - Check network connectivity

3. **Image Not Displaying**
   - Verify image URL is correct
   - Check if image is publicly accessible
   - Ensure proper CORS headers for images

4. **Database Errors**
   - Run the database migration script
   - Check if profile_image_url column exists
   - Verify user permissions

## Database Migration

Run this SQL script to add the profile image field:

```sql
-- Add profile image field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN users.profile_image_url IS 'URL of the user profile image stored in Supabase Storage';
```

This completes the profile image upload implementation guide. The backend is now ready to handle profile image uploads, and you have comprehensive frontend examples for different frameworks.
