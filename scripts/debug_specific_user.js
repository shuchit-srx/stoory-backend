const { supabaseAdmin } = require('../supabase/client');

/**
 * Debug script for the specific user ID the frontend is using
 */
async function debugSpecificUser() {
  console.log('🔍 Debugging specific user issue...\n');

  try {
    // The user ID from frontend logs
    const frontendUserId = '79318220-1edb-49e1-9671-3fc683b56e82';
    
    console.log(`🔍 Checking user: ${frontendUserId}`);

    // Check if this user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', frontendUserId)
      .single();

    if (userError) {
      console.log(`❌ User not found: ${userError.message}`);
      
      // Check if user exists with different ID
      console.log('\n🔍 Checking all users in database...');
      const { data: allUsers, error: allUsersError } = await supabaseAdmin
        .from('users')
        .select('id, name, phone, role, created_at')
        .limit(10);

      if (allUsersError) {
        console.log('❌ Error fetching users:', allUsersError.message);
        return;
      }

      console.log(`✅ Found ${allUsers.length} users:`);
      allUsers.forEach((u, index) => {
        console.log(`   ${index + 1}. ID: ${u.id}`);
        console.log(`      Name: ${u.name}`);
        console.log(`      Phone: ${u.phone}`);
        console.log(`      Role: ${u.role}`);
        console.log(`      Created: ${u.created_at}`);
        console.log('');
      });

      // Check if there are conversations for this user
      console.log('\n🔍 Checking conversations for frontend user ID...');
      const { data: conversations, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .or(`brand_owner_id.eq.${frontendUserId},influencer_id.eq.${frontendUserId}`);

      if (convError) {
        console.log('❌ Error checking conversations:', convError.message);
      } else {
        console.log(`📊 Found ${conversations?.length || 0} conversations for frontend user`);
        if (conversations && conversations.length > 0) {
          conversations.forEach((conv, index) => {
            console.log(`   ${index + 1}. ID: ${conv.id}`);
            console.log(`      Brand Owner: ${conv.brand_owner_id}`);
            console.log(`      Influencer: ${conv.influencer_id}`);
            console.log(`      Chat Status: ${conv.chat_status}`);
            console.log('');
          });
        }
      }

    } else {
      console.log('✅ User found:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Phone: ${user.phone}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Created: ${user.created_at}`);

      // Check conversations for this user
      console.log('\n🔍 Checking conversations for this user...');
      const { data: conversations, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .or(`brand_owner_id.eq.${frontendUserId},influencer_id.eq.${frontendUserId}`);

      if (convError) {
        console.log('❌ Error checking conversations:', convError.message);
      } else {
        console.log(`📊 Found ${conversations?.length || 0} conversations`);
        if (conversations && conversations.length > 0) {
          conversations.forEach((conv, index) => {
            console.log(`   ${index + 1}. ID: ${conv.id}`);
            console.log(`      Brand Owner: ${conv.brand_owner_id}`);
            console.log(`      Influencer: ${conv.influencer_id}`);
            console.log(`      Chat Status: ${conv.chat_status}`);
            console.log('');
          });
        }
      }
    }

    // Check if the issue is with the phone number
    console.log('\n🔍 Checking if user exists by phone number...');
    const frontendPhone = '8143540685'; // From the JWT token
    
    const { data: userByPhone, error: phoneError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone', frontendPhone)
      .single();

    if (phoneError) {
      console.log(`❌ No user found with phone: ${frontendPhone}`);
      console.log('💡 This explains why the frontend user ID is different!');
      console.log('\n🔧 Solution:');
      console.log('   1. The frontend is using a different phone number');
      console.log('   2. This creates a new user with a different ID');
      console.log('   3. The new user has no conversations');
      console.log('   4. Use the test phone numbers: 9876543211 or 9876543212');
    } else {
      console.log('✅ User found by phone:');
      console.log(`   ID: ${userByPhone.id}`);
      console.log(`   Name: ${userByPhone.name}`);
      console.log(`   Phone: ${userByPhone.phone}`);
      console.log(`   Role: ${userByPhone.role}`);
    }

  } catch (error) {
    console.error('💥 Debug failed:', error.message);
  }
}

// Run the debug
if (require.main === module) {
  debugSpecificUser();
}

module.exports = { debugSpecificUser };
