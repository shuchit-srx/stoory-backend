const { supabaseAdmin } = require('../supabase/client');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File type configurations
const FILE_TYPES = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'],
    maxSize: 1024 * 1024 * 1024, // 1GB
    folder: 'chat-images'
  },
  video: {
    extensions: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'],
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'video/x-m4v'],
    maxSize: 500 * 1024 * 1024, // 500MB
    folder: 'chat-videos'
  },
  document: {
    extensions: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx'],
    mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    maxSize: 200 * 1024 * 1024, // 200MB
    folder: 'chat-documents'
  },
  audio: {
    extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac'],
    maxSize: 200 * 1024 * 1024, // 200MB - increased for high-quality audio
    folder: 'chat-audio'
  }
};

// File filter for all supported types
const fileFilter = (req, file, cb) => {
  const fileType = getFileType(file.originalname, file.mimetype);
  
  if (fileType) {
    req.fileType = fileType; // Store file type for later use
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type! Only images, videos, documents, and audio files are allowed.'), false);
  }
};

// Configure multer with dynamic limits
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max (will be overridden by file type)
  }
});

/**
 * Determine file type based on extension and MIME type
 */
function getFileType(fileName, mimeType) {
  const ext = path.extname(fileName).toLowerCase();
  
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (config.extensions.includes(ext) || config.mimeTypes.includes(mimeType)) {
      return type;
    }
  }
  return null;
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    
    // Videos
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v',
    
    // Documents
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.rtf': 'application/rtf',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Generate unique filename
 */
function generateUniqueFileName(originalName, fileType) {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  
  return `${fileType}/${timestamp}_${randomString}_${baseName}${ext}`;
}

/**
 * Upload attachment to Supabase Storage
 */
async function uploadAttachment(fileBuffer, fileName, fileType, conversationId, userId) {
  try {
    console.log('Starting attachment upload process...');
    console.log('File name:', fileName);
    console.log('File type:', fileType);
    console.log('File buffer size:', fileBuffer.length, 'bytes');
    console.log('Conversation ID:', conversationId);
    console.log('User ID:', userId);

    // Get file type configuration
    const typeConfig = FILE_TYPES[fileType];
    if (!typeConfig) {
      throw new Error(`Invalid file type: ${fileType}`);
    }

    // Generate unique filename
    const uniqueFileName = generateUniqueFileName(fileName, typeConfig.folder);
    console.log('Generated filename:', uniqueFileName);

    // Detect MIME type
    const mimeType = getMimeType(fileName);
    console.log('Detected MIME type:', mimeType);

    // Upload to Supabase Storage
    console.log('Uploading to Supabase Storage...');
    const { data, error } = await supabaseAdmin.storage
      .from('attachments')
      .upload(uniqueFileName, fileBuffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    console.log('Upload successful, data:', data);

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('attachments')
      .getPublicUrl(uniqueFileName);

    console.log('Public URL generated:', urlData.publicUrl);

    // Create attachment metadata
    const attachmentMetadata = {
      url: urlData.publicUrl,
      fileName: fileName,
      fileType: fileType,
      mimeType: mimeType,
      size: fileBuffer.length,
      conversationId: conversationId,
      uploadedBy: userId,
      uploadedAt: new Date().toISOString(),
      storagePath: uniqueFileName
    };

    return { 
      success: true, 
      attachment: attachmentMetadata,
      error: null 
    };

  } catch (error) {
    console.error('Attachment upload error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Delete attachment from Supabase Storage
 */
async function deleteAttachment(attachmentUrl) {
  try {
    if (!attachmentUrl) {
      return { success: true, error: null };
    }

    // Extract file path from URL
    const urlParts = attachmentUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];
    const filePath = `${folder}/${fileName}`;

    const { error } = await supabaseAdmin.storage
      .from('attachments')
      .remove([filePath]);

    if (error) {
      console.error('Supabase storage delete error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('Attachment deletion error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get attachment preview data
 */
function getAttachmentPreview(attachment) {
  const { fileType, mimeType, fileName, size, url } = attachment;
  
  const preview = {
    type: fileType,
    fileName: fileName,
    size: size,
    url: url,
    canPreview: false,
    thumbnail: null,
    icon: getFileIcon(fileType)
  };

  // Determine if file can be previewed
  if (fileType === 'image') {
    preview.canPreview = true;
    preview.thumbnail = url;
  } else if (fileType === 'video') {
    preview.canPreview = true;
    // For videos, we might want to generate a thumbnail
    preview.thumbnail = null; // Could be implemented later
  } else if (fileType === 'audio') {
    preview.canPreview = true;
  } else {
    preview.canPreview = false;
  }

  return preview;
}

/**
 * Get file icon based on type
 */
function getFileIcon(fileType) {
  const icons = {
    image: '🖼️',
    video: '🎥',
    document: '📄',
    audio: '🎵'
  };
  return icons[fileType] || '📎';
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Determine file type from filename and mime type
 */
function validateFileType(fileName, mimeType) {
  const ext = path.extname(fileName).toLowerCase();
  
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (config.extensions.includes(ext) || config.mimeTypes.includes(mimeType)) {
      return { valid: true, fileType: type, error: null };
    }
  }
  
  return { valid: false, fileType: null, error: 'Unsupported file type' };
}

/**
 * Validate file before upload
 */
function validateFile(fileBuffer, fileName, mimeType) {
  // First validate file type
  const typeValidation = validateFileType(fileName, mimeType);
  if (!typeValidation.valid) {
    return { valid: false, error: typeValidation.error };
  }

  const fileType = typeValidation.fileType;
  const typeConfig = FILE_TYPES[fileType];
  
  if (!typeConfig) {
    return { valid: false, error: 'Invalid file type' };
  }

  // Validate file size
  if (fileBuffer.length > typeConfig.maxSize) {
    const maxSizeMB = Math.round(typeConfig.maxSize / (1024 * 1024));
    return { 
      valid: false, 
      error: `File size exceeds limit for ${fileType} files (${maxSizeMB}MB maximum)` 
    };
  }

  return { valid: true, fileType: fileType, error: null };
}

module.exports = {
  upload,
  uploadAttachment,
  deleteAttachment,
  getAttachmentPreview,
  getFileIcon,
  formatFileSize,
  validateFile,
  validateFileType,
  getFileType,
  FILE_TYPES
};
