require('dotenv').config();
const { supabaseAdmin } = require('../supabase/client');
const AutomatedFlowService = require('../utils/automatedFlowService');

async function verifyWorkSubmission() {
    console.log('🚀 Starting Work Submission Verification...');

    try {
        // 1. Find an influencer
        const { data: influencer, error: userError } = await supabaseAdmin
            .from('users')
            .select('id, name')
            .eq('role', 'influencer')
            .limit(1)
            .single();

        if (userError || !influencer) {
            throw new Error('No influencer found for testing');
        }
        console.log(`👤 Found Influencer: ${influencer.name} (${influencer.id})`);

        // 2. Find a Brand Owner
        const { data: brandOwner, error: brandError } = await supabaseAdmin
            .from('users')
            .select('id, name')
            .eq('role', 'brand_owner')
            .limit(1)
            .single();

        if (brandError || !brandOwner) {
            throw new Error('No brand owner found for testing');
        }
        console.log(`🏢 Found Brand Owner: ${brandOwner.name} (${brandOwner.id})`);

        // 3. Find or Create a Campaign
        let { data: campaign } = await supabaseAdmin
            .from('campaigns')
            .select('id, title')
            .eq('created_by', brandOwner.id)
            .limit(1)
            .maybeSingle();

        if (!campaign) {
            console.log('⚠️ No campaign found. Creating a test campaign...');
            const { data: newCampaign, error: createCampError } = await supabaseAdmin
                .from('campaigns')
                .insert({
                    created_by: brandOwner.id,
                    title: 'Test Campaign for Work Submission',
                    description: 'Created by verification script',
                    min_budget: 1000,
                    max_budget: 5000,
                    status: 'open',
                    start_date: new Date().toISOString(),
                    end_date: new Date(Date.now() + 86400000).toISOString() // Tomorrow
                })
                .select()
                .single();

            if (createCampError) throw createCampError;
            campaign = newCampaign;
        }
        console.log(`📢 Using Campaign: ${campaign.title} (${campaign.id})`);

        // 4. Find or Create a Conversation
        let { data: conversation } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('influencer_id', influencer.id)
            .eq('brand_owner_id', brandOwner.id)
            .eq('campaign_id', campaign.id)
            .maybeSingle();

        if (!conversation) {
            console.log('⚠️ No conversation found. Creating one...');
            const { data: newConv, error: createConvError } = await supabaseAdmin
                .from('conversations')
                .insert({
                    influencer_id: influencer.id,
                    brand_owner_id: brandOwner.id,
                    campaign_id: campaign.id,
                    flow_state: 'work_in_progress',
                    awaiting_role: 'influencer',
                    chat_status: 'automated'
                })
                .select()
                .single();

            if (createConvError) throw createConvError;
            conversation = newConv;
        } else {
            // Ensure it's in the right state
            if (conversation.flow_state !== 'work_in_progress') {
                console.log(`🔄 Updating conversation state to 'work_in_progress'...`);
                const { data: updatedConv, error: updateError } = await supabaseAdmin
                    .from('conversations')
                    .update({
                        flow_state: 'work_in_progress',
                        awaiting_role: 'influencer'
                    })
                    .eq('id', conversation.id)
                    .select()
                    .single();

                if (updateError) throw updateError;
                conversation = updatedConv;
            }
        }

        console.log(`💬 Using Conversation: ${conversation.id}`);
        console.log(`   Current State: ${conversation.flow_state}`);

        // 5. Ensure a Request exists (linked to conversation)
        // Many flows rely on a request object for status updates
        let { data: request } = await supabaseAdmin
            .from('requests')
            .select('id')
            .eq('campaign_id', campaign.id)
            .eq('influencer_id', influencer.id)
            .maybeSingle();

        if (!request) {
            console.log('⚠️ No request found. Creating one...');
            const { data: newRequest, error: reqError } = await supabaseAdmin
                .from('requests')
                .insert({
                    campaign_id: campaign.id,
                    influencer_id: influencer.id,
                    status: 'finalized',
                    proposed_amount: 1500
                })
                .select()
                .single();

            if (reqError) throw reqError;
            request = newRequest;
        }

        // Link request to conversation if not already
        if (conversation.request_id !== request.id) {
            await supabaseAdmin
                .from('conversations')
                .update({ request_id: request.id })
                .eq('id', conversation.id);
            console.log('🔗 Linked request to conversation');
        }

        // 6. Simulate Work Submission
        // AutomatedFlowService is already an instance
        const automatedFlowService = AutomatedFlowService;
        // Set IO to null to verify notification logic works without socket
        automatedFlowService.setIO(null);

        const submissionData = {
            deliverables: 'https://example.com/work-link',
            description: 'This is a test submission from the verification script.',
            submission_notes: 'Hope you like it!',
            attachments: []
        };

        console.log('📤 Submitting work...');
        const result = await automatedFlowService.handleWorkSubmission(conversation.id, submissionData);

        console.log('✅ Submission Result:', result);

        // 7. Verify Database Updates
        console.log('🔍 Verifying Database Updates...');

        // Check conversation state
        const { data: finalConv } = await supabaseAdmin
            .from('conversations')
            .select('flow_state, awaiting_role, request_id, chat_status')
            .eq('id', conversation.id)
            .single();
        console.log('   Conversation State:', finalConv.flow_state);
        console.log('   Awaiting Role:', finalConv.awaiting_role);
        console.log('   Chat Status:', finalConv.chat_status); // Check chat status

        if (finalConv.flow_state === 'work_submitted' && finalConv.awaiting_role === 'brand_owner' && finalConv.chat_status === 'automated') {
            console.log('✅ Conversation state and chat status updated correctly.');
        } else {
            console.error('❌ Conversation state or chat status update FAILED.');
        }

        // Check request status
        if (finalConv.request_id) {
            const { data: finalRequest } = await supabaseAdmin
                .from('requests')
                .select('status, work_submission_link, work_description')
                .eq('id', finalConv.request_id)
                .single();

            console.log('   Request Status:', finalRequest.status);
            console.log('   Work Link:', finalRequest.work_submission_link);

            if (finalRequest.status === 'work_submitted') {
                console.log('✅ Request status updated correctly.');
            } else {
                console.error('❌ Request status update FAILED.');
            }
        }

        // Check if message was created
        const { data: messages } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(1);

        if (messages && messages.length > 0) {
            const lastMsg = messages[0];
            console.log('   Last Message Type:', lastMsg.message_type);

            if (lastMsg.message.includes('Work Submitted')) {
                console.log('✅ Confirmation message created.');
            } else {
                console.warn('⚠️ Last message might not be the submission confirmation.');
            }

            // Check for notification
            console.log('🔍 Verifying Notification Creation...');
            const { data: notifications } = await supabaseAdmin
                .from('notifications')
                .select('*')
                .eq('user_id', conversation.brand_owner_id)
                .eq('type', 'message')
                .order('created_at', { ascending: false })
                .limit(1);

            if (notifications && notifications.length > 0) {
                const lastNotif = notifications[0];
                // Check if it's recent (within last minute)
                const notifTime = new Date(lastNotif.created_at).getTime();
                const now = Date.now();
                if (now - notifTime < 60000) {
                    console.log('✅ Notification created for Brand Owner.');
                    console.log('   Title:', lastNotif.title);
                } else {
                    console.warn('⚠️ Found notification but it seems old.');
                }
            } else {
                console.error('❌ No notification created for Brand Owner.');
            }

        } else {
            console.error('❌ No message created.');
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error);
    }
}

verifyWorkSubmission();
