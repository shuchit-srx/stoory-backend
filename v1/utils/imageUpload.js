const { supabaseAdmin } = require('../db/config');
const multer = require('multer');
const path = require('path');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter to only allow images
const fileFilter = (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    }
});

/**
 * Upload image to Supabase Storage
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The file name
 * @param {string} folder - The folder to upload to (e.g., 'bids', 'campaigns')
 * @returns {Promise<{url: string, error: string}>}
 */
async function uploadImageToStorage(fileBuffer, fileName, folder) {
    try {
        console.log('Starting image upload process...');
        console.log('File name:', fileName);
        console.log('Folder:', folder);
        console.log('File buffer size:', fileBuffer.length, 'bytes');

        // Generate unique filename
        const timestamp = Date.now();
        const fileExtension = path.extname(fileName);
        const uniqueFileName = `${folder}/${timestamp}_${Math.random().toString(36).substring(2)}${fileExtension}`;
        
        console.log('Generated filename:', uniqueFileName);

        // Detect MIME type
        const mimeType = getMimeType(fileName);
        console.log('Detected MIME type:', mimeType);

        // Upload to Supabase Storage
        console.log('Uploading to Supabase Storage...');
        const { data, error } = await supabaseAdmin.storage
            .from('images')
            .upload(uniqueFileName, fileBuffer, {
                contentType: mimeType,
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error('Supabase storage upload error:', error);
            console.error('Error details:', {
                message: error.message,
                statusCode: error.statusCode,
                error: error.error
            });
            return { url: null, error: error.message };
        }

        console.log('Upload successful, data:', data);

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from('images')
            .getPublicUrl(uniqueFileName);

        console.log('Public URL generated:', urlData.publicUrl);
        return { url: urlData.publicUrl, error: null };
    } catch (error) {
        console.error('Image upload error:', error);
        console.error('Error stack:', error.stack);
        return { url: null, error: error.message };
    }
}

/**
 * Get MIME type based on file extension
 * @param {string} fileName - The file name
 * @returns {string} MIME type
 */
function getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Delete image from Supabase Storage
 * @param {string} imageUrl - The image URL to delete
 * @returns {Promise<{success: boolean, error: string}>}
 */
async function deleteImageFromStorage(imageUrl) {
    try {
        if (!imageUrl) {
            return { success: true, error: null };
        }

        // Extract file path from URL
        const urlParts = imageUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const folder = urlParts[urlParts.length - 2];
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabaseAdmin.storage
            .from('images')
            .remove([filePath]);

        if (error) {
            console.error('Supabase storage delete error:', error);
            return { success: false, error: error.message };
        }

        return { success: true, error: null };
    } catch (error) {
        console.error('Image deletion error:', error);
        return { success: false, error: error.message };
    }
}

// Multer configuration for bulk campaign files (allows multiple file types)
const uploadBulkCampaignFiles = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit for bulk campaign files
    }
    // No fileFilter - allow all file types for bulk campaigns
});

// File filter for portfolio media (images and videos)
const portfolioFileFilter = (req, file, cb) => {
    // Check file type - allow images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image and video files are allowed for portfolio!'), false);
    }
};

// Multer configuration for portfolio files (images and videos)
const uploadPortfolioMedia = multer({
    storage: storage,
    fileFilter: portfolioFileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit for portfolio media (videos can be large)
    }
});

/**
 * Upload portfolio media (image or video) to Supabase Storage
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The file name
 * @param {string} mimeType - The MIME type of the file
 * @returns {Promise<{url: string, error: string}>}
 */
async function uploadPortfolioMediaToStorage(fileBuffer, fileName, mimeType) {
    try {
        console.log('Starting portfolio media upload process...');
        console.log('File name:', fileName);
        console.log('MIME type:', mimeType);
        console.log('File buffer size:', fileBuffer.length, 'bytes');

        // Determine bucket based on file type
        const isVideo = mimeType.startsWith('video/');
        const bucket = isVideo ? 'attachments' : 'images'; // Videos go to attachments, images to images bucket
        const folder = isVideo ? 'portfolio/videos' : 'portfolio/images';

        // Generate unique filename
        const timestamp = Date.now();
        const fileExtension = path.extname(fileName);
        const uniqueFileName = `${folder}/${timestamp}_${Math.random().toString(36).substring(2)}${fileExtension}`;
        
        console.log('Generated filename:', uniqueFileName);
        console.log('Target bucket:', bucket);

        // Upload to Supabase Storage
        console.log('Uploading to Supabase Storage...');
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .upload(uniqueFileName, fileBuffer, {
                contentType: mimeType,
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error('Supabase storage upload error:', error);
            console.error('Error details:', {
                message: error.message,
                statusCode: error.statusCode,
                error: error.error
            });
            return { url: null, error: error.message };
        }

        console.log('Upload successful, data:', data);

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from(bucket)
            .getPublicUrl(uniqueFileName);

        console.log('Public URL generated:', urlData.publicUrl);
        return { url: urlData.publicUrl, error: null };
    } catch (error) {
        console.error('Portfolio media upload error:', error);
        console.error('Error stack:', error.stack);
        return { url: null, error: error.message };
    }
}

/**
 * Delete portfolio media from Supabase Storage
 * @param {string} mediaUrl - The media URL to delete
 * @returns {Promise<{success: boolean, error: string}>}
 */
async function deletePortfolioMediaFromStorage(mediaUrl) {
    try {
        if (!mediaUrl) {
            return { success: true, error: null };
        }

        // Determine bucket from URL
        const isVideo = mediaUrl.includes('/portfolio/videos/');
        const bucket = isVideo ? 'attachments' : 'images';

        // Extract file path from URL
        const urlParts = mediaUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const folder = urlParts[urlParts.length - 2];
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabaseAdmin.storage
            .from(bucket)
            .remove([filePath]);

        if (error) {
            console.error('Supabase storage delete error:', error);
            return { success: false, error: error.message };
        }

        return { success: true, error: null };
    } catch (error) {
        console.error('Portfolio media deletion error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    upload,
    uploadBulkCampaignFiles,
    uploadPortfolioMedia,
    uploadImageToStorage,
    deleteImageFromStorage,
    uploadPortfolioMediaToStorage,
    deletePortfolioMediaFromStorage
};
