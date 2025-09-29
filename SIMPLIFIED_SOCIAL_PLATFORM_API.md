# Simplified Social Platform API

## 📋 **Simplified Social Platform Upload**

For now, only **username** and **followers_count** are required for social platform uploads.

### **Endpoint:**
```http
POST /api/auth/social-platforms
Authorization: Bearer <token>
Content-Type: application/json
```

### **Required Fields:**
```json
{
  "platform_name": "instagram",
  "followers_count": 1000
}
```

### **Optional Fields:**
```json
{
  "profile_link": "https://instagram.com/john_doe",
  "engagement_rate": 5.5
}
```

### **Validation Rules:**
- **platform_name**: Required, 2-50 characters (e.g., "instagram", "youtube", "tiktok")
- **followers_count**: Required, non-negative integer
- **profile_link**: Optional, valid URL
- **engagement_rate**: Optional, 0-100 decimal

### **Response:**
```json
{
  "success": true,
  "platform": {
    "id": "uuid",
    "user_id": "uuid",
    "platform": "instagram",
    "username": "john_doe",
    "followers_count": 1000,
    "is_connected": true,
    "platform_is_active": true,
    "created_at": "2025-01-01T00:00:00Z"
  },
  "message": "Social platform added successfully"
}
```

## 🎯 **Frontend Usage**

### **Simple Social Platform Form:**
```javascript
const addSocialPlatform = async (platformData) => {
  try {
    const response = await axios.post('/api/auth/social-platforms', {
      platform_name: platformData.platformName,
      profile_link: platformData.profileLink,
      followers_count: parseInt(platformData.followersCount),
      engagement_rate: parseFloat(platformData.engagementRate)
    }, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Failed to add social platform:', error.response?.data || error.message);
    throw error;
  }
};
```

### **React Component Example:**
```jsx
const SocialPlatformForm = () => {
  const [formData, setFormData] = useState({
    platform: 'instagram',
    username: '',
    followersCount: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      await addSocialPlatform(formData);
      alert('Social platform added successfully!');
      setFormData({ platform: 'instagram', username: '', followersCount: '' });
    } catch (error) {
      alert('Failed to add social platform: ' + error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <select 
        value={formData.platform} 
        onChange={(e) => setFormData({...formData, platform: e.target.value})}
        required
      >
        <option value="instagram">Instagram</option>
        <option value="facebook">Facebook</option>
        <option value="youtube">YouTube</option>
        <option value="tiktok">TikTok</option>
        <option value="twitter">Twitter</option>
        <option value="linkedin">LinkedIn</option>
        <option value="snapchat">Snapchat</option>
      </select>
      
      <input
        type="text"
        placeholder="Username"
        value={formData.username}
        onChange={(e) => setFormData({...formData, username: e.target.value})}
        required
      />
      
      <input
        type="number"
        placeholder="Followers Count"
        value={formData.followersCount}
        onChange={(e) => setFormData({...formData, followersCount: e.target.value})}
        min="0"
        required
      />
      
      <button type="submit">Add Platform</button>
    </form>
  );
};
```

## ✅ **Benefits of Simplified Approach**

1. **Easy to implement** - Only 3 required fields
2. **Fast validation** - Minimal validation rules
3. **Quick testing** - Simple test cases
4. **Future extensible** - Can add more fields later
5. **Clear requirements** - No confusion about optional fields

## 🚨 **Error Handling**

### **Common Errors:**
```json
// Invalid platform
{
  "success": false,
  "message": "Platform must be one of: instagram, facebook, youtube, tiktok, twitter, linkedin, snapchat"
}

// Missing username
{
  "success": false,
  "message": "Username is required"
}

// Invalid followers count
{
  "success": false,
  "message": "Followers count must be a non-negative integer"
}

// Platform already exists
{
  "success": false,
  "message": "Platform already exists for this user"
}
```

This simplified approach makes it much easier to get social platform uploads working quickly!
