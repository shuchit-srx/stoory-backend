const { supabaseAdmin } = require("../supabase/client");

/**
 * Verify the current status of message_type field and constraints
 */
async function verifyMessageTypeStatus() {
  console.log("🔍 Verifying message_type field status...\n");

  try {
    // Step 1: Check if message_type column exists and has data
    console.log("📊 Checking message_type column status...");
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("messages")
      .select("id, message_type, message")
      .limit(10);

    if (messagesError) {
      console.error(
        "❌ Error accessing messages table:",
        messagesError.message
      );
      return;
    }

    console.log(
      `✅ Messages table accessible, found ${messages.length} sample messages`
    );

    // Check if message_type column exists
    const hasMessageType =
      messages[0] && messages[0].hasOwnProperty("message_type");
    if (hasMessageType) {
      console.log("✅ message_type column exists");
    } else {
      console.log("❌ message_type column does not exist");
      return;
    }

    // Step 2: Check message_type distribution
    console.log("\n📊 Current message_type distribution:");
    const typeCounts = {};
    messages.forEach((msg) => {
      const type = msg.message_type || "NULL";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    Object.entries(typeCounts).forEach(([type, count]) => {
      console.log(`   • ${type}: ${count} messages`);
    });

    // Step 3: Check for invalid message types
    const validTypes = ["user_input", "automated", "system"];
    const invalidTypes = Object.keys(typeCounts).filter(
      (type) => type !== "NULL" && !validTypes.includes(type)
    );

    if (invalidTypes.length > 0) {
      console.log(
        `\n⚠️ Found invalid message types: ${invalidTypes.join(", ")}`
      );
      console.log("   These need to be updated before adding the constraint");
    } else {
      console.log("\n✅ All message types are valid!");
    }

    // Step 4: Check if constraint already exists
    console.log("\n🔍 Checking for existing constraints...");
    try {
      // Try to insert a message with invalid type to see if constraint exists
      const testMessage = {
        conversation_id:
          messages[0]?.conversation_id ||
          "00000000-0000-0000-0000-000000000000",
        sender_id:
          messages[0]?.sender_id || "00000000-0000-0000-0000-000000000000",
        receiver_id:
          messages[0]?.receiver_id || "00000000-0000-0000-0000-000000000000",
        message: "Test message for constraint verification",
        message_type: "invalid_type_for_testing",
        created_at: new Date().toISOString(),
      };

      const { data: newMessage, error: insertError } = await supabaseAdmin
        .from("messages")
        .insert(testMessage)
        .select()
        .single();

      if (insertError) {
        if (
          insertError.message.includes("check constraint") ||
          insertError.message.includes("check_message_type")
        ) {
          console.log("✅ Check constraint already exists and is working!");
          console.log("   Constraint violation error:", insertError.message);
        } else {
          console.log(
            "⚠️ Insert failed for different reason:",
            insertError.message
          );
        }
      } else {
        console.log(
          "⚠️ No constraint found - invalid message_type was accepted"
        );
        console.log("   Constraint needs to be added");

        // Clean up test message
        await supabaseAdmin.from("messages").delete().eq("id", newMessage.id);
        console.log("🧹 Test message cleaned up");
      }
    } catch (error) {
      console.log("⚠️ Error testing constraint:", error.message);
    }

    // Step 5: Test valid message types
    console.log("\n🧪 Testing valid message types...");
    const validTestMessages = [
      { message_type: "user_input", message: "Test user input message" },
      { message_type: "automated", message: "Test automated message" },
      { message_type: "system", message: "Test system message" },
    ];

    for (const testMsg of validTestMessages) {
      try {
        const { data: newMessage, error: insertError } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id:
              messages[0]?.conversation_id ||
              "00000000-0000-0000-0000-000000000000",
            sender_id:
              messages[0]?.sender_id || "00000000-0000-0000-0000-000000000000",
            receiver_id:
              messages[0]?.receiver_id ||
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

    // Step 6: Summary and recommendations
    console.log("\n📋 Status Summary:");
    console.log(
      `   • message_type column: ${hasMessageType ? "✅ Exists" : "❌ Missing"}`
    );
    console.log(
      `   • Valid message types: ${
        invalidTypes.length === 0
          ? "✅ All valid"
          : `⚠️ ${invalidTypes.length} invalid`
      }`
    );
    console.log(
      `   • Constraint status: ${
        invalidTypes.length === 0 ? "Ready to add" : "Needs data fix"
      }`
    );

    if (invalidTypes.length === 0) {
      console.log("\n🎉 Ready to add constraint!");
      console.log("\n🔧 Add this constraint via Supabase dashboard:");
      console.log("   Name: check_message_type");
      console.log("   Type: Check");
      console.log(
        "   Expression: message_type IN ('user_input', 'automated', 'system')"
      );

      console.log("\n💻 Or run this SQL:");
      console.log(
        "   ALTER TABLE messages ADD CONSTRAINT check_message_type CHECK (message_type IN ('user_input', 'automated', 'system'));"
      );
    } else {
      console.log("\n⚠️ Data needs to be fixed before adding constraint");
      console.log("   Run: node scripts/fix_message_type_constraint.js");
    }
  } catch (error) {
    console.error("💥 Verification failed:", error.message);
    console.log("\n🔍 Troubleshooting:");
    console.log("   1. Check database connection");
    console.log("   2. Verify table permissions");
    console.log("   3. Check if messages table exists");
  }
}

// Run the verification
if (require.main === module) {
  verifyMessageTypeStatus();
}

module.exports = { verifyMessageTypeStatus };
