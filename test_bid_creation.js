const { supabaseAdmin } = require('./supabase/client');

async function testBidCreation() {
    try {
        console.log('Testing bid creation...');
        
        // Test data
        const testBidData = {
            title: 'Test Bid',
            description: 'Test description',
            min_budget: 1000,
            max_budget: 5000,
            requirements: 'Test requirements',
            language: 'English',
            platform: 'Instagram',
            content_type: 'Video',
            category: 'Test',
            created_by: '00000000-0000-0000-0000-000000000000' // Replace with actual user ID
        };

        console.log('Inserting test bid with data:', testBidData);

        const { data, error } = await supabaseAdmin
            .from('bids')
            .insert(testBidData)
            .select()
            .single();

        if (error) {
            console.error('❌ Database error:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
        } else {
            console.log('✅ Bid created successfully:', data);
        }

    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

// Check if bids table exists and has correct structure
async function checkBidsTable() {
    try {
        console.log('Checking bids table structure...');
        
        const { data, error } = await supabaseAdmin
            .from('bids')
            .select('*')
            .limit(1);

        if (error) {
            console.error('❌ Error accessing bids table:', error);
        } else {
            console.log('✅ Bids table accessible');
            if (data && data.length > 0) {
                console.log('Sample bid structure:', Object.keys(data[0]));
            }
        }

    } catch (error) {
        console.error('❌ Exception checking table:', error);
    }
}

// Run tests
async function runTests() {
    console.log('🔍 Starting bid creation tests...\n');
    
    await checkBidsTable();
    console.log('\n---\n');
    await testBidCreation();
}

runTests();
