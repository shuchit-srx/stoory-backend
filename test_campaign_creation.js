const { supabaseAdmin } = require('./supabase/client');

async function testCampaignCreation() {
    try {
        console.log('Testing campaign creation...');
        
        // Test data matching your frontend format
        const testCampaignData = {
            name: 'Test Campaign',
            description: 'Test campaign description',
            min_budget: 5000,
            max_budget: 25000,
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            category: 'product',
            targetAudience: 'Test audience',
            contentType: 'Video',
            language: 'English',
            platform: 'Instagram',
            sendingPackageToInfluencer: 'no',
            noOfPackages: 5
        };

        console.log('Test campaign data:', testCampaignData);

        // Check if campaigns table exists and has correct structure
        const { data: tableCheck, error: tableError } = await supabaseAdmin
            .from('campaigns')
            .select('*')
            .limit(1);

        if (tableError) {
            console.error('❌ Error accessing campaigns table:', tableError);
            return;
        }

        console.log('✅ Campaigns table accessible');
        if (tableCheck && tableCheck.length > 0) {
            console.log('📋 Available columns:', Object.keys(tableCheck[0]));
        }

        // Test campaign creation with proper data mapping
        const campaignData = {
            title: testCampaignData.name,
            description: testCampaignData.description || '',
            min_budget: testCampaignData.min_budget ? parseFloat(testCampaignData.min_budget) : null,
            max_budget: testCampaignData.max_budget ? parseFloat(testCampaignData.max_budget) : null,
            start_date: testCampaignData.start_date || null,
            end_date: testCampaignData.end_date || null,
            campaign_type: testCampaignData.category === 'product' ? 'product' : 'service',
            requirements: testCampaignData.targetAudience || null,
            deliverables: testCampaignData.contentType ? [testCampaignData.contentType] : [],
            image_url: testCampaignData.image || null,
            language: testCampaignData.language || null,
            platform: testCampaignData.platform || null,
            content_type: testCampaignData.contentType || null,
            sending_package: testCampaignData.sendingPackageToInfluencer === 'yes',
            no_of_packages: testCampaignData.noOfPackages ? parseInt(testCampaignData.noOfPackages) : null,
            created_by: '83def83b-fe8f-4d4a-be6e-1a3954258bb2' // Use existing user ID
        };

        console.log('Mapped campaign data:', campaignData);

        const { data: campaign, error } = await supabaseAdmin
            .from('campaigns')
            .insert(campaignData)
            .select()
            .single();

        if (error) {
            console.error('❌ Database error creating campaign:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
        } else {
            console.log('✅ Campaign created successfully:', campaign);
        }

    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

// Check database structure
async function checkCampaignsTableStructure() {
    try {
        console.log('🔍 Checking campaigns table structure...');
        
        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .select('*')
            .limit(1);

        if (error) {
            console.error('❌ Error accessing campaigns table:', error);
        } else {
            console.log('✅ Campaigns table accessible');
            if (data && data.length > 0) {
                console.log('📋 Available columns:', Object.keys(data[0]));
            }
        }

    } catch (error) {
        console.error('❌ Exception checking table:', error);
    }
}

// Run tests
async function runTests() {
    console.log('🚀 Starting campaign creation tests...\n');
    
    await checkCampaignsTableStructure();
    console.log('\n---\n');
    await testCampaignCreation();
}

runTests();
