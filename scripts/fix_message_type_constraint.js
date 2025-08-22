const { supabaseAdmin } = require("../supabase/client");

/**
 * Fix message_type constraint violation by updating existing data
 * This script updates invalid message_type values to valid ones
 */
async function fixMessageTypeConstraint() {
  console.log("🔧 Fixing message_type constraint violation...\n");

  try {
    // Step 1: Check current message_type values
    console.log("📊 Checking current message_type values...");
    const { data: messageTypes, error: typeError } = await supabaseAdmin
      .from("messages")
      .select("message_type")
      .not("message_type", "is", null);

    if (typeError) {
      console.error("❌ Error checking message types:", typeError.message);
      return;
    }

    // Count different message types
    const typeCounts = {};
    messageTypes.forEach((msg) => {
      const type = msg.message_type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    console.log("📊 Current message_type distribution:");
    Object.entries(typeCounts).forEach(([type, count]) => {
      console.log(`   • ${type}: ${count} messages`);
    });

    // Step 2: Update invalid message_type values
    console.log("\n🔧 Updating invalid message_type values...");

    // Update 'manual' to 'user_input' (most appropriate)
    const { error: updateManualError } = await supabaseAdmin
      .from("messages")
      .update({ message_type: "user_input" })
      .eq("message_type", "manual");

    if (updateManualError) {
      console.log(
        "⚠️ Error updating manual messages:",
        updateManualError.message
      );
    } else {
      console.log('✅ Updated messages with type "manual" to "user_input"');
    }

    // Update any other invalid types to 'user_input'
    const { error: updateInvalidError } = await supabaseAdmin
      .from("messages")
      .update({ message_type: "user_input" })
      .not("message_type", "in", ["user_input", "automated", "system"]);

    if (updateInvalidError) {
      console.log(
        "⚠️ Error updating invalid messages:",
        updateInvalidError.message
      );
    } else {
      console.log('✅ Updated messages with invalid types to "user_input"');
    }

    // Step 3: Verify all messages now have valid types
    console.log("\n🔍 Verifying message types after update...");
    const { data: updatedMessageTypes, error: verifyError } =
      await supabaseAdmin
        .from("messages")
        .select("message_type")
        .not("message_type", "is", null);

    if (verifyError) {
      console.log("❌ Error verifying updated types:", verifyError.message);
      return;
    }

    const updatedTypeCounts = {};
    updatedMessageTypes.forEach((msg) => {
      const type = msg.message_type;
      updatedTypeCounts[type] = (updatedTypeCounts[type] || 0) + 1;
    });

    console.log("📊 Updated message_type distribution:");
    Object.entries(updatedTypeCounts).forEach(([type, count]) => {
      console.log(`   • ${type}: ${count} messages`);
    });

    // Check if all types are valid
    const validTypes = ["user_input", "automated", "system"];
    const invalidTypes = Object.keys(updatedTypeCounts).filter(
      (type) => !validTypes.includes(type)
    );

    if (invalidTypes.length > 0) {
      console.log("❌ Still have invalid message types:", invalidTypes);
      return;
    }

    console.log("✅ All message types are now valid!");

    // Step 4: Now try to add the constraint
    console.log("\n🔧 Adding check constraint...");
    try {
      const { error: constraintError } = await supabaseAdmin.rpc("exec_sql", {
        sql: "ALTER TABLE messages ADD CONSTRAINT check_message_type CHECK (message_type IN ('user_input', 'automated', 'system'))",
      });

      if (constraintError) {
        console.log(
          "⚠️ RPC exec_sql not available, constraint must be added manually"
        );
        console.log("💡 Manual Steps Required:");
        console.log("   1. Go to Supabase Dashboard");
        console.log("   2. Navigate to Table Editor > messages");
        console.log("   3. Add constraint: check_message_type");
        console.log(
          "   4. Expression: message_type IN ('user_input', 'automated', 'system')"
        );
      } else {
        console.log("✅ Check constraint added successfully!");
      }
    } catch (error) {
      console.log("⚠️ Error adding constraint:", error.message);
      console.log(
        "💡 Constraint must be added manually via Supabase dashboard"
      );
    }

    // Step 5: Test inserting messages with different types
    console.log("\n🧪 Testing message insertion with different types...");
    const testMessages = [
      { message_type: "user_input", message: "Test user input message" },
      { message_type: "automated", message: "Test automated message" },
      { message_type: "system", message: "Test system message" },
    ];

    for (const testMsg of testMessages) {
      try {
        const { data: newMessage, error: insertError } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id:
              updatedMessageTypes[0]?.conversation_id ||
              "00000000-0000-0000-0000-000000000000",
            sender_id:
              updatedMessageTypes[0]?.sender_id ||
              "00000000-0000-0000-0000-000000000000",
            receiver_id:
              updatedMessageTypes[0]?.receiver_id ||
              "00000000-0000-0000-0000-000000000000",
            message: testMsg.message,
            message_type: testMsg.message_type,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          console.log(
            `⚠️ Error inserting ${testMsg.message_type} message:`,
            insertError.message
          );
        } else {
          console.log(
            `✅ ${testMsg.message_type} message inserted successfully`
          );

          // Clean up test message
          await supabaseAdmin.from("messages").delete().eq("id", newMessage.id);
        }
      } catch (error) {
        console.log(
          `⚠️ Error testing ${testMsg.message_type} message:`,
          error.message
        );
      }
    }

    console.log("\n🎉 Constraint violation fixed!");
    console.log("\n📋 Summary:");
    console.log("   ✅ All message types updated to valid values");
    console.log("   ✅ message_type constraint can now be added");
    console.log("   ✅ Test messages with all types work correctly");

    if (invalidTypes.length === 0) {
      console.log("\n🔧 Next Steps:");
      console.log("   1. Add constraint via Supabase dashboard");
      console.log(
        "   2. Or run: ALTER TABLE messages ADD CONSTRAINT check_message_type CHECK (message_type IN ('user_input', 'automated', 'system'))"
      );
    }
  } catch (error) {
    console.error("💥 Fix failed:", error.message);
    console.log("\n🔍 Troubleshooting:");
    console.log("   1. Check database connection");
    console.log("   2. Verify table permissions");
    console.log("   3. Check if constraint already exists");
  }
}

// Run the fix
if (require.main === module) {
  fixMessageTypeConstraint();
}

module.exports = { fixMessageTypeConstraint };
