const { supabaseAdmin } = require('./supabase/client');

async function testBidUpdate() {
    try {
        console.log('Testing bid update...');
        
        // First, let's check if there are any existing bids
        const { data: existingBids, error: fetchError } = await supabaseAdmin
            .from('bids')
            .select('*')
            .limit(1);

        if (fetchError) {
            console.error('❌ Error fetching bids:', fetchError);
            return;
        }

        if (!existingBids || existingBids.length === 0) {
            console.log('No existing bids found. Creating a test bid first...');
            
            // Create a test bid
            const { data: newBid, error: createError } = await supabaseAdmin
                .from('bids')
                .insert({
                    title: 'Test Bid for Update',
                    description: 'Original description',
                    min_budget: 1000,
                    max_budget: 5000,
                    requirements: 'Original requirements',
                    language: 'English',
                    platform: 'Instagram',
                    content_type: 'Video',
                    category: 'Test',
                    created_by: '00000000-0000-0000-0000-000000000000' // Replace with actual user ID
                })
                .select()
                .single();

            if (createError) {
                console.error('❌ Error creating test bid:', createError);
                return;
            }

            console.log('✅ Test bid created:', newBid);
            await testUpdate(newBid.id);
        } else {
            console.log('✅ Found existing bid:', existingBids[0]);
            await testUpdate(existingBids[0].id);
        }

    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

async function testUpdate(bidId) {
    try {
        console.log(`\n🔄 Testing update for bid ID: ${bidId}`);
        
        // Test update data
        const updateData = {
            title: 'Updated Test Bid',
            description: 'Updated description',
            min_budget: 2000,
            max_budget: 8000,
            requirements: 'Updated requirements',
            language: 'Hindi',
            platform: 'YouTube',
            content_type: 'Image',
            category: 'Updated Test'
        };

        console.log('📝 Update data:', updateData);

        const { data: updatedBid, error } = await supabaseAdmin
            .from('bids')
            .update(updateData)
            .eq('id', bidId)
            .select()
            .single();

        if (error) {
            console.error('❌ Database error updating bid:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
        } else {
            console.log('✅ Bid updated successfully:', updatedBid);
            
            // Verify the update
            console.log('\n📊 Update verification:');
            console.log('Title changed:', updateData.title === updatedBid.title);
            console.log('Min budget changed:', updateData.min_budget === updatedBid.min_budget);
            console.log('Max budget changed:', updateData.max_budget === updatedBid.max_budget);
        }

    } catch (error) {
        console.error('❌ Exception updating bid:', error);
    }
}

// Check database structure
async function checkBidsTableStructure() {
    try {
        console.log('🔍 Checking bids table structure...');
        
        const { data, error } = await supabaseAdmin
            .from('bids')
            .select('*')
            .limit(1);

        if (error) {
            console.error('❌ Error accessing bids table:', error);
        } else {
            console.log('✅ Bids table accessible');
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
    console.log('🚀 Starting bid update tests...\n');
    
    await checkBidsTableStructure();
    console.log('\n---\n');
    await testBidUpdate();
}

runTests();
