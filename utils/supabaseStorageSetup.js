// Supabase Storage Setup Utility
// This script can help you set up storage buckets and policies programmatically

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupStorage() {
  try {
    console.log('Setting up Supabase Storage...');

    // 1. Create the images bucket
    const { data: bucket, error: bucketError } = await supabase.storage.createBucket('images', {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      fileSizeLimit: 5242880 // 5MB in bytes
    });

    if (bucketError) {
      if (bucketError.message.includes('already exists')) {
        console.log('Bucket "images" already exists');
      } else {
        throw bucketError;
      }
    } else {
      console.log('Bucket "images" created successfully');
    }

    // 2. Set bucket policies (this requires admin access)
    console.log('Storage bucket created. Please set policies via Supabase Dashboard:');
    console.log('1. Go to Storage → images bucket → Policies');
    console.log('2. Create policy: "Allow authenticated uploads"');
    console.log('3. Policy: (bucket_id = \'images\')');
    console.log('4. Permissions: INSERT, SELECT, UPDATE, DELETE');
    console.log('5. Target roles: authenticated');
    
    console.log('\nFolder structure in images bucket:');
    console.log('- campaigns/ (for campaign images)');
    console.log('- bids/ (for bid images)');
    console.log('- profiles/ (for user profile images) - will be created automatically');

  } catch (error) {
    console.error('Error setting up storage:', error);
  }
}

// Run the setup
if (require.main === module) {
  setupStorage();
}

module.exports = { setupStorage };
