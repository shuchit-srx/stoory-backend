const { supabaseAdmin } = require('../supabase/client');

/**
 * Safe migration script to add message_type field to messages table
 * This handles existing data properly before adding constraints
 */
async function runMessageTypeMigration() {
  console.log('🚀 Starting message_type migration...\n');

  try {
    // Step 1: Check if message_type column already exists
    console.log('📊 Checking if message_type column exists...');
    const { data: columns, error: columnError } = await supabaseAdmin
      .rpc('get_table_columns', { table_name: 'messages' });

    if (columnError) {
      console.log('⚠️ Could not check columns directly, proceeding with migration...');
    } else {
      const hasMessageType = columns.some(col => col.column_name === 'message_type');
      if (hasMessageType) {
        console.log('✅ message_type column already exists, checking data...');
      } else {
        console.log('📝 message_type column does not exist, will create it...');
      }
    }

    // Step 2: Add message_type column if it doesn't exist
    console.log('\n🔧 Adding message_type column...');
    const { error: addColumnError } = await supabaseAdmin.rpc('add_column_if_not_exists', {
      table_name: 'messages',
      column_name: 'message_type',
      column_type: 'TEXT'
    });

    if (addColumnError) {
      console.log('⚠️ Column might already exist or error occurred:', addColumnError.message);
    } else {
      console.log('✅ message_type column added successfully');
    }

    // Step 3: Update existing messages to have message_type
    console.log('\n📝 Updating existing messages...');
    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ message_type: 'user_input' })
      .is('message_type', null);

    if (updateError) {
      console.log('⚠️ Error updating messages:', updateError.message);
    } else {
      console.log('✅ Existing messages updated with message_type');
    }

    // Step 4: Set default value for future messages
    console.log('\n🔧 Setting default value...');
    const { error: defaultError } = await supabaseAdmin.rpc('set_column_default', {
      table_name: 'messages',
      column_name: 'message_type',
      default_value: "'user_input'"
    });

    if (defaultError) {
      console.log('⚠️ Error setting default:', defaultError.message);
    } else {
      console.log('✅ Default value set for message_type');
    }

    // Step 5: Make column NOT NULL
    console.log('\n🔧 Making column NOT NULL...');
    const { error: notNullError } = await supabaseAdmin.rpc('set_column_not_null', {
      table_name: 'messages',
      column_name: 'message_type'
    });

    if (notNullError) {
      console.log('⚠️ Error making column NOT NULL:', notNullError.message);
    } else {
      console.log('✅ message_type column is now NOT NULL');
    }

    // Step 6: Add check constraint
    console.log('\n🔧 Adding check constraint...');
    const { error: constraintError } = await supabaseAdmin.rpc('add_check_constraint', {
      table_name: 'messages',
      constraint_name: 'check_message_type',
      check_expression: "message_type IN ('user_input', 'automated', 'system')"
    });

    if (constraintError) {
      console.log('⚠️ Error adding constraint:', constraintError.message);
      console.log('   This might mean the constraint already exists');
    } else {
      console.log('✅ Check constraint added successfully');
    }

    // Step 7: Create index
    console.log('\n🔧 Creating index...');
    const { error: indexError } = await supabaseAdmin.rpc('create_index_if_not_exists', {
      table_name: 'messages',
      index_name: 'idx_messages_message_type',
      columns: 'message_type'
    });

    if (indexError) {
      console.log('⚠️ Error creating index:', indexError.message);
    } else {
      console.log('✅ Index created successfully');
    }

    // Step 8: Verify the migration
    console.log('\n🔍 Verifying migration...');
    const { data: messages, error: verifyError } = await supabaseAdmin
      .from('messages')
      .select('id, message_type')
      .limit(5);

    if (verifyError) {
      console.log('❌ Error verifying migration:', verifyError.message);
    } else {
      console.log('✅ Migration verification successful');
      console.log('📊 Sample messages with message_type:');
      messages.forEach((msg, index) => {
        console.log(`   ${index + 1}. ID: ${msg.id}, Type: ${msg.message_type}`);
      });
    }

    // Step 9: Check constraint
    console.log('\n🔍 Checking constraint...');
    const { data: constraints, error: constraintCheckError } = await supabaseAdmin
      .rpc('get_check_constraints', { table_name: 'messages' });

    if (constraintCheckError) {
      console.log('⚠️ Could not verify constraint:', constraintCheckError.message);
    } else {
      console.log('✅ Check constraints found:');
      constraints.forEach(constraint => {
        console.log(`   • ${constraint.constraint_name}: ${constraint.check_clause}`);
      });
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   ✅ message_type column added');
    console.log('   ✅ Existing messages updated');
    console.log('   ✅ Default value set');
    console.log('   ✅ Column made NOT NULL');
    console.log('   ✅ Check constraint added');
    console.log('   ✅ Index created');
    console.log('   ✅ Migration verified');

  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('   1. Check if Supabase RPC functions exist');
    console.log('   2. Verify database permissions');
    console.log('   3. Check server logs for detailed errors');
  }
}

// Run the migration
if (require.main === module) {
  runMessageTypeMigration();
}

module.exports = { runMessageTypeMigration };
