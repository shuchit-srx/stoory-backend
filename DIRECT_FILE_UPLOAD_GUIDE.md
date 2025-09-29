# 📁 Direct File Upload Integration Guide

## 🎯 Overview

This guide covers the **simplified** file upload system that uploads files directly to Supabase Storage and creates messages with file URLs. No base64 conversion needed!

## 🏗️ Backend Implementation

### Single Endpoint

**`POST /api/files/conversations/:conversation_id/upload`**

- **Method**: POST
- **Content-Type**: multipart/form-data
- **Authorization**: Bearer token

**Form Data:**
- `file`: The actual file (image, video, document, audio)
- `message`: Optional text message
- `message_type`: Optional, defaults to "user_input"

### Supported File Types & Limits

| Type | Extensions | Max Size |
|------|------------|----------|
| **Images** | .jpg, .jpeg, .png, .gif, .webp, .bmp, .svg | 1GB |
| **Videos** | .mp4, .mov, .avi, .mkv, .webm, .m4v | 1GB |
| **Documents** | .pdf, .doc, .docx, .txt, .rtf, .odt, .xls, .xlsx, .ppt, .pptx | 500MB |
| **Audio** | .mp3, .wav, .ogg, .m4a, .aac, .flac | 200MB |

### Other Endpoints

- **`DELETE /api/files/files/:message_id`** - Delete file
- **`GET /api/files/files/:message_id`** - Get file info
- **`GET /api/files/supported-types`** - Get supported file types

## 🎨 Frontend Implementation

### 1. React Native File Upload

```javascript
// hooks/useFileUpload.js
import { useState } from 'react';

export const useFileUpload = (conversationId, userId) => {
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file, message = '') => {
    try {
      setUploading(true);
      
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        type: file.type,
        name: file.name,
      });
      formData.append('message', message);
      formData.append('message_type', 'user_input');

      const response = await fetch(`/api/files/conversations/${conversationId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message);
      }
      
      return result;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  return { uploadFile, uploading };
};
```

### 2. File Picker Component

```javascript
// components/FileUploader.jsx
import React from 'react';
import { DocumentPicker } from 'react-native-document-picker';
import { useFileUpload } from '../hooks/useFileUpload';

const FileUploader = ({ conversationId, userId, onUploadComplete }) => {
  const { uploadFile, uploading } = useFileUpload(conversationId, userId);

  const pickAndUploadFile = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: false,
      });

      const file = result[0];
      const uploadResult = await uploadFile(file, `Sent ${file.name}`);
      onUploadComplete?.(uploadResult);
    } catch (err) {
      if (DocumentPicker.isCancel(err)) {
        console.log('User cancelled file picker');
      } else {
        console.error('File picker error:', err);
      }
    }
  };

  return (
    <Button 
      title={uploading ? "Uploading..." : "Upload File"} 
      onPress={pickAndUploadFile}
      disabled={uploading}
    />
  );
};

export default FileUploader;
```

### 3. Image Picker Component

```javascript
// components/ImageUploader.jsx
import React from 'react';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { useFileUpload } from '../hooks/useFileUpload';

const ImageUploader = ({ conversationId, userId, onUploadComplete }) => {
  const { uploadFile, uploading } = useFileUpload(conversationId, userId);

  const pickImage = (source) => {
    const options = {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 2000,
      maxHeight: 2000,
    };

    const pickerFunction = source === 'camera' ? launchCamera : launchImageLibrary;

    pickerFunction(options, async (response) => {
      if (response.didCancel || response.error) {
        return;
      }

      const file = {
        uri: response.assets[0].uri,
        name: response.assets[0].fileName || 'image.jpg',
        type: response.assets[0].type || 'image/jpeg',
      };

      try {
        const result = await uploadFile(file, 'Sent an image');
        onUploadComplete?.(result);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    });
  };

  return (
    <View>
      <Button 
        title="Take Photo" 
        onPress={() => pickImage('camera')}
        disabled={uploading}
      />
      <Button 
        title="Choose from Gallery" 
        onPress={() => pickImage('gallery')}
        disabled={uploading}
      />
    </View>
  );
};

export default ImageUploader;
```

## 📱 React Native Setup

### 1. Install Dependencies

```bash
npm install react-native-document-picker
npm install react-native-image-picker
# For iOS:
cd ios && pod install
```

### 2. Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

### 3. iOS Permissions

Add to `ios/YourApp/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>This app needs access to camera to take photos</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>This app needs access to photo library to select images</string>
```

## 🔧 API Response Format

### Successful Upload Response

```json
{
  "success": true,
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "uuid",
    "receiver_id": "uuid",
    "message": "Sent an image",
    "media_url": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
    "message_type": "user_input",
    "attachment_metadata": {
      "fileName": "image.jpg",
      "fileType": "image",
      "mimeType": "image/jpeg",
      "size": 1024000,
      "preview": {
        "type": "image",
        "fileName": "image.jpg",
        "size": 1024000,
        "url": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
        "canPreview": true,
        "thumbnail": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
        "icon": "🖼️"
      }
    },
    "created_at": "2025-01-28T05:14:25.787Z"
  },
  "file": {
    "url": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
    "fileName": "image.jpg",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "size": 1024000,
    "conversationId": "uuid",
    "uploadedBy": "uuid",
    "uploadedAt": "2025-01-28T05:14:25.787Z",
    "storagePath": "chat-images/1738044865787_abc123_image.jpg"
  },
  "preview": {
    "type": "image",
    "fileName": "image.jpg",
    "size": 1024000,
    "url": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
    "canPreview": true,
    "thumbnail": "https://storage.supabase.co/attachments/chat-images/1738044865787_abc123_image.jpg",
    "icon": "🖼️"
  }
}
```

### Error Response

```json
{
  "success": false,
  "message": "File size exceeds limit for image files (1073741824MB)"
}
```

## 🚀 Key Benefits

1. **✅ Direct file upload** - No base64 conversion needed
2. **✅ Single endpoint** - One endpoint handles everything
3. **✅ Large file support** - Up to 1GB for images/videos
4. **✅ Real-time updates** - Socket.IO integration
5. **✅ Clean URLs** - Direct Supabase Storage URLs
6. **✅ File validation** - Type and size validation
7. **✅ Easy integration** - Simple multipart/form-data

## 🎯 Usage Example

```javascript
// Upload a file
const formData = new FormData();
formData.append('file', fileObject);
formData.append('message', 'Check this out!');

const response = await fetch('/api/files/conversations/123/upload', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: formData
});

const result = await response.json();
// result.file.url contains the direct file URL
// result.message contains the created message
```

This approach is much simpler and more efficient than base64 conversion!
