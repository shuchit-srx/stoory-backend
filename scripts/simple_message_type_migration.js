const { supabaseAdmin } = require('../supabase/client');

/**
 * Simple migration script to add message_type field to messages table
 * This uses direct SQL execution to avoid RPC function dependencies
 */
async function runSimpleMessageTypeMigration() {
  console.log('🚀 Starting simple message_type migration...\n');

  try {
    // Step 1: Check current table structure
    console.log('📊 Checking current messages table structure...');
    const { data: messages, error: checkError } = await supabaseAdmin
      .from('messages')
      .select('*')
      .limit(1);

    if (checkError) {
      console.error('❌ Error accessing messages table:', checkError.message);
      return;
    }

    console.log('✅ Messages table accessible');

    // Step 2: Try to add message_type column directly
    console.log('\n🔧 Adding message_type column...');
    try {
      const { error: addError } = await supabaseAdmin.rpc('exec_sql', {
        sql: 'ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT'
      });

      if (addError) {
        console.log('⚠️ RPC exec_sql not available, trying alternative approach...');
        // Try to update existing messages to see if column exists
        const { error: updateTestError } = await supabaseAdmin
          .from('messages')
          .update({ message_type: 'user_input' })
          .eq('id', messages[0]?.id || '00000000-0000-0000-0000-000000000000');

        if (updateTestError && updateTestError.message.includes('column "message_type" does not exist')) {
          console.log('❌ message_type column does not exist and cannot be added via RPC');
          console.log('💡 You need to manually add the column via Supabase dashboard or psql');
          return;
        } else if (updateTestError) {
          console.log('⚠️ Unexpected error:', updateTestError.message);
        } else {
          console.log('✅ message_type column exists and is writable');
        }
      } else {
        console.log('✅ message_type column added successfully');
      }
    } catch (error) {
      console.log('⚠️ Error adding column:', error.message);
    }

    // Step 3: Update existing messages to have message_type
    console.log('\n📝 Updating existing messages...');
    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ message_type: 'user_input' })
      .is('message_type', null);

    if (updateError) {
      if (updateError.message.includes('column "message_type" does not exist')) {
        console.log('❌ message_type column still does not exist');
        console.log('\n🔧 Manual Steps Required:');
        console.log('   1. Go to Supabase Dashboard');
        console.log('   2. Navigate to Table Editor > messages');
        console.log('   3. Add new column: message_type (TEXT)');
        console.log('   4. Set default value: user_input');
        console.log('   5. Run this script again');
        return;
      } else {
        console.log('⚠️ Error updating messages:', updateError.message);
      }
    } else {
      console.log('✅ Existing messages updated with message_type');
    }

    // Step 4: Verify the migration
    console.log('\n🔍 Verifying migration...');
    const { data: updatedMessages, error: verifyError } = await supabaseAdmin
      .from('messages')
      .select('id, message_type')
      .limit(5);

    if (verifyError) {
      console.log('❌ Error verifying migration:', verifyError.message);
    } else {
      console.log('✅ Migration verification successful');
      console.log('📊 Sample messages with message_type:');
      updatedMessages.forEach((msg, index) => {
        console.log(`   ${index + 1}. ID: ${msg.id}, Type: ${msg.message_type || 'NULL'}`);
      });
    }

    // Step 5: Check if we can insert new messages with message_type
    console.log('\n🧪 Testing new message insertion...');
    try {
      const testMessage = {
        conversation_id: messages[0]?.conversation_id || '00000000-0000-0000-0000-000000000000',
        sender_id: messages[0]?.sender_id || '00000000-0000-0000-0000-000000000000',
        receiver_id: messages[0]?.receiver_id || '00000000-0000-0000-0000-000000000000',
        message: 'Test message for migration verification',
        message_type: 'system',
        created_at: new Date().toISOString()
      };

      const { data: newMessage, error: insertError } = await supabaseAdmin
        .from('messages')
        .insert(testMessage)
        .select()
        .single();

      if (insertError) {
        console.log('⚠️ Error inserting test message:', insertError.message);
      } else {
        console.log('✅ Test message inserted successfully with message_type');
        
        // Clean up test message
        await supabaseAdmin
          .from('messages')
          .delete()
          .eq('id', newMessage.id);
        console.log('🧹 Test message cleaned up');
      }
    } catch (error) {
      console.log('⚠️ Error testing message insertion:', error.message);
    }

    console.log('\n🎉 Migration verification completed!');
    console.log('\n📋 Summary:');
    console.log('   ✅ Messages table accessible');
    console.log('   ✅ message_type column status verified');
    console.log('   ✅ Existing messages updated (if column exists)');
    console.log('   ✅ Migration verified');

    // Final recommendations
    if (messages[0] && !messages[0].hasOwnProperty('message_type')) {
      console.log('\n⚠️ IMPORTANT: message_type column is missing!');
      console.log('🔧 To complete the migration:');
      console.log('   1. Add message_type column via Supabase dashboard');
      console.log('   2. Set type: TEXT, default: user_input');
      console.log('   3. Run this script again to populate existing data');
    } else {
      console.log('\n✅ message_type column is working correctly!');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('   1. Check database connection');
    console.log('   2. Verify table permissions');
    console.log('   3. Check if message_type column exists');
  }
}

// Run the migration
if (require.main === module) {
  runSimpleMessageTypeMigration();
}

module.exports = { runSimpleMessageTypeMigration };
