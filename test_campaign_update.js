const { supabaseAdmin } = require('./supabase/client');

async function testCampaignUpdate() {
    try {
        console.log('Testing campaign update...');
        
        // First, let's check if there are any existing campaigns
        const { data: existingCampaigns, error: fetchError } = await supabaseAdmin
            .from('campaigns')
            .select('*')
            .limit(1);

        if (fetchError) {
            console.error('❌ Error fetching campaigns:', fetchError);
            return;
        }

        if (!existingCampaigns || existingCampaigns.length === 0) {
            console.log('No existing campaigns found. Creating a test campaign first...');
            
            // Create a test campaign
            const { data: newCampaign, error: createError } = await supabaseAdmin
                .from('campaigns')
                .insert({
                    title: 'Test Campaign for Update',
                    description: 'Original description',
                    min_budget: 1000,
                    max_budget: 5000,
                    requirements: 'Original requirements',
                    language: 'English',
                    platform: 'Instagram',
                    content_type: 'Video',
                    campaign_type: 'product',
                    created_by: '83def83b-fe8f-4d4a-be6e-1a3954258bb2' // Use existing user ID
                })
                .select()
                .single();

            if (createError) {
                console.error('❌ Error creating test campaign:', createError);
                return;
            }

            console.log('✅ Test campaign created:', newCampaign);
            await testUpdate(newCampaign.id);
        } else {
            console.log('✅ Found existing campaign:', existingCampaigns[0]);
            await testUpdate(existingCampaigns[0].id);
        }

    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

async function testUpdate(campaignId) {
    try {
        console.log(`\n🔄 Testing update for campaign ID: ${campaignId}`);
        
        // Test update data (matching frontend field names)
        const updateData = {
            name: 'Updated Test Campaign',
            description: 'Updated description',
            min_budget: 2000,
            max_budget: 8000,
            targetAudience: 'Updated requirements',
            language: 'Hindi',
            platform: 'YouTube',
            contentType: 'Image',
            category: 'service',
            expiryDate: '2025-12-31T23:59:59Z'
        };

        console.log('📝 Update data:', updateData);

        const { data: updatedCampaign, error } = await supabaseAdmin
            .from('campaigns')
            .update({
                title: updateData.name,
                description: updateData.description,
                min_budget: updateData.min_budget,
                max_budget: updateData.max_budget,
                requirements: updateData.targetAudience,
                language: updateData.language,
                platform: updateData.platform,
                content_type: updateData.contentType,
                campaign_type: updateData.category,
                end_date: updateData.expiryDate
            })
            .eq('id', campaignId)
            .select()
            .single();

        if (error) {
            console.error('❌ Database error updating campaign:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
        } else {
            console.log('✅ Campaign updated successfully:', updatedCampaign);
            
            // Verify the update
            console.log('\n📊 Update verification:');
            console.log('Title changed:', updateData.name === updatedCampaign.title);
            console.log('Min budget changed:', updateData.min_budget === updatedCampaign.min_budget);
            console.log('Max budget changed:', updateData.max_budget === updatedCampaign.max_budget);
        }

    } catch (error) {
        console.error('❌ Exception updating campaign:', error);
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
    console.log('🚀 Starting campaign update tests...\n');
    
    await checkCampaignsTableStructure();
    console.log('\n---\n');
    await testCampaignUpdate();
}

runTests();
