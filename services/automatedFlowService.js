const { supabaseAdmin } = require('../supabase/client');
const stateMachineService = require('./stateMachineService');
const paymentService = require('./paymentService');
const escrowService = require('./escrowService');

class AutomatedFlowService {
  /**
   * Initialize automated conversation for a bid application
   */
  async initializeBidConversation(bidId, influencerId, proposedAmount) {
    try {
      // Get bid details
      const { data: bid, error: bidError } = await supabaseAdmin
        .from('bids')
        .select(`
          *,
          users!bids_created_by_fkey(id, name, email, phone)
        `)
        .eq('id', bidId)
        .single();

      if (bidError || !bid) {
        throw new Error('Bid not found');
      }

      const brandOwnerId = bid.created_by;

      // Check if conversation already exists
      const { data: existingConv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('bid_id', bidId)
        .eq('influencer_id', influencerId)
        .eq('brand_owner_id', brandOwnerId)
        .single();

      if (existingConv) {
        throw new Error('Conversation already exists');
      }

      // Create request record first to track the collaboration
      const { data: request, error: requestError } = await supabaseAdmin
        .from('requests')
        .insert({
          bid_id: bidId,
          influencer_id: influencerId,
          status: 'connected',
          final_agreed_amount: parseFloat(proposedAmount),
          initial_payment: Math.round(parseFloat(proposedAmount) * 0.3 * 100) / 100, // 30% in paise
          final_payment: Math.round(parseFloat(proposedAmount) * 0.7 * 100) / 100   // 70% in paise
        })
        .select()
        .single();

      if (requestError) {
        throw new Error(`Failed to create request: ${requestError.message}`);
      }

      // Create conversation linked to the request
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .insert({
          bid_id: bidId,
          brand_owner_id: brandOwnerId,
          influencer_id: influencerId,
          request_id: request.id,
          flow_state: 'influencer_responding',
          awaiting_role: 'influencer',
          chat_status: 'automated',
          flow_data: {
            proposed_amount: parseFloat(proposedAmount),
            current_amount: parseFloat(proposedAmount),
            negotiation_history: []
          }
        })
        .select()
        .single();

      if (convError) {
        throw new Error(`Failed to create conversation: ${convError.message}`);
      }

      // Create initial message
      const { data: message, error: msgError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          sender_id: brandOwnerId,
          receiver_id: influencerId,
          message: `🤝 **Interest in Collaboration**\n\nHi! I'm interested in your bid "${bid.title}". Proposed amount: **₹${proposedAmount}**.`,
          message_type: 'system',
          action_required: true,
          action_data: {
            title: 'Connection Response',
            subtitle: 'Choose your response to connect on this bid',
            buttons: [
              { id: 'accept_connection', text: 'Accept Connection', style: 'success', action: 'accept_connection' },
              { id: 'reject_connection', text: 'Reject Connection', style: 'danger', action: 'reject_connection' }
            ],
            flow_state: 'influencer_responding',
            visible_to: 'influencer'
          }
        })
        .select()
        .single();

      if (msgError) {
        console.error('Failed to create initial message:', msgError);
      }

      return {
        success: true,
        conversation,
        request,
        message
      };
    } catch (error) {
      console.error('Error initializing bid conversation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle brand owner actions
   */
  async handleBrandOwnerAction(conversationId, action, data = {}) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      let newFlowState, newAwaitingRole, newMessage, auditMessage;

      switch (action) {
        case 'send_project_details':
          newFlowState = 'influencer_reviewing';
          newAwaitingRole = 'influencer';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `Here are the project details: ${data.details}`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Project Details',
              subtitle: 'Please review the details',
              buttons: [
                {
                  id: 'accept_project',
                  text: 'Accept Project',
                  action: 'accept_project',
                  style: 'primary'
                },
                {
                  id: 'request_changes',
                  text: 'Request Changes',
                  action: 'request_changes',
                  style: 'secondary'
                }
              ]
            }
          };
          break;

        case 'send_price_offer':
          newFlowState = 'influencer_price_response';
          newAwaitingRole = 'influencer';
          
          // Update request with the price offer
          if (conversation.request_id) {
            const { error: requestUpdateError } = await supabaseAdmin
              .from('requests')
              .update({
                final_agreed_amount: parseFloat(data.price),
                initial_payment: Math.round(parseFloat(data.price) * 0.3 * 100) / 100,
                final_payment: Math.round(parseFloat(data.price) * 0.7 * 100) / 100,
                updated_at: new Date().toISOString()
              })
              .eq('id', conversation.request_id);

            if (requestUpdateError) {
              console.error('Failed to update request with price offer:', requestUpdateError);
            }
          }

          // Update conversation flow data with negotiation history
          const currentFlowData = conversation.flow_data || {};
          const negotiationHistory = currentFlowData.negotiation_history || [];
          negotiationHistory.push({
            type: 'brand_offer',
            amount: parseFloat(data.price),
            timestamp: new Date().toISOString(),
            message: `Brand owner offered ₹${data.price}`
          });

          const updatedFlowData = {
            ...currentFlowData,
            current_amount: parseFloat(data.price),
            negotiation_history: negotiationHistory
          };

          // Update conversation with new flow data
          await supabaseAdmin
            .from('conversations')
            .update({
              flow_data: updatedFlowData,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `I'm offering ₹${data.price} for this project. What do you think?`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Price Offer',
              subtitle: `Amount: ₹${data.price}`,
              buttons: [
                {
                  id: 'accept_price',
                  text: 'Accept Price',
                  action: 'accept_price',
                  style: 'primary'
                },
                {
                  id: 'negotiate_price',
                  text: 'Negotiate Price',
                  action: 'negotiate_price',
                  style: 'secondary'
                }
              ]
            }
          };
          break;

        case 'proceed_to_payment':
          newFlowState = 'payment_pending';
          newAwaitingRole = 'brand_owner';
          
          // Get the agreed amount from flow data
          const agreedAmount = conversation.flow_data?.agreed_amount || conversation.flow_data?.current_amount || 0;
          
          if (agreedAmount <= 0) {
            throw new Error('Agreed amount is required for payment');
          }

          // Update request status to negotiating
          if (conversation.request_id) {
            const { error: requestUpdateError } = await supabaseAdmin
              .from('requests')
              .update({
                status: 'negotiating',
                final_agreed_amount: parseFloat(agreedAmount),
                updated_at: new Date().toISOString()
              })
              .eq('id', conversation.request_id);

            if (requestUpdateError) {
              console.error('Failed to update request status:', requestUpdateError);
            }
          }

          // Create payment order in the database
          const { data: paymentOrder, error: orderError } = await supabaseAdmin
            .from('payment_orders')
            .insert({
              conversation_id: conversationId,
              amount_paise: Math.round(parseFloat(agreedAmount) * 100), // Convert to paise
              currency: 'INR',
              status: 'created',
              metadata: {
                conversation_type: conversation.bid_id ? 'bid' : 'campaign',
                brand_owner_id: conversation.brand_owner_id,
                influencer_id: conversation.influencer_id,
                agreed_amount: parseFloat(agreedAmount)
              }
            })
            .select()
            .single();

          if (orderError) {
            throw new Error(`Failed to create payment order: ${orderError.message}`);
          }

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `Great! Let's proceed with the payment of ₹${agreedAmount}. Please complete the payment to start the collaboration.`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Payment Required',
              subtitle: `Amount: ₹${agreedAmount}`,
              payment_order: {
                id: paymentOrder.id,
                amount_paise: paymentOrder.amount_paise,
                currency: paymentOrder.currency,
                status: paymentOrder.status
              },
              buttons: [
                {
                  id: 'pay_now',
                  text: 'Pay Now',
                  action: 'proceed_to_payment',
                  style: 'primary'
                }
              ]
            }
          };
          break;

        case 'approve_work':
          newFlowState = 'work_approved';
          newAwaitingRole = null;
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: 'Excellent work! I approve the submission.',
            message_type: 'system',
            is_automated: true,
            action_required: false
          };

          // Release escrow funds
          if (conversation.escrow_hold_id) {
            await escrowService.releaseEscrowFunds(
              conversation.escrow_hold_id,
              'Work approved by brand owner',
              conversation.brand_owner_id
            );
          }
          break;

        case 'request_revision':
          newFlowState = 'work_revision_requested';
          newAwaitingRole = 'influencer';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `I'd like some revisions: ${data.feedback || 'Please make the requested changes.'}`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Revision Requested',
              subtitle: 'Please make the requested changes',
              buttons: [
                {
                  id: 'resubmit_work',
                  text: 'Resubmit Work',
                  action: 'resubmit_work',
                  style: 'primary'
                }
              ]
            }
          };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
        updated_at: new Date().toISOString()
      };

      // Note: final_agreed_amount field removed as it doesn't exist in conversations table
      // Price information should be passed as data parameter when needed

      const { error: updateError } = await supabaseAdmin
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Create message
      const { data: createdMessage, error: messageError } = await supabaseAdmin
        .from('messages')
        .insert(newMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      return {
        success: true,
        conversation: {
          ...conversation,
          ...updateData
        },
        message: createdMessage
      };
    } catch (error) {
      console.error('Error handling brand owner action:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle influencer actions
   */
  async handleInfluencerAction(conversationId, action, data = {}) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      let newFlowState, newAwaitingRole, newMessage;

      switch (action) {
        case 'accept':
          newFlowState = 'brand_owner_details';
          newAwaitingRole = 'brand_owner';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: 'Great! I\'m interested in this project. Please share the details.',
            message_type: 'system',
            is_automated: true,
            action_required: false
          };
          break;

        case 'reject':
          newFlowState = 'collaboration_cancelled';
          newAwaitingRole = null;
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: 'Thank you for considering me, but I\'m not available for this project.',
            message_type: 'system',
            is_automated: true,
            action_required: false
          };
          break;

        case 'accept_project':
          newFlowState = 'influencer_price_response';
          newAwaitingRole = 'influencer';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: 'The project details look good! What\'s your budget for this?',
            message_type: 'system',
            is_automated: true,
            action_required: false
          };
          break;

        case 'accept_price':
          newFlowState = 'payment_pending';
          newAwaitingRole = 'brand_owner';
          
          // Get the current amount from flow data
          const currentAmount = conversation.flow_data?.current_amount || data.price;
          
          // Update request with final agreed amount
          if (conversation.request_id) {
            const { error: requestUpdateError } = await supabaseAdmin
              .from('requests')
              .update({
                final_agreed_amount: parseFloat(currentAmount),
                initial_payment: Math.round(parseFloat(currentAmount) * 0.3 * 100) / 100,
                final_payment: Math.round(parseFloat(currentAmount) * 0.7 * 100) / 100,
                status: 'negotiating',
                updated_at: new Date().toISOString()
              })
              .eq('id', conversation.request_id);

            if (requestUpdateError) {
              console.error('Failed to update request with accepted price:', requestUpdateError);
            }
          }

          // Update conversation flow data
          const acceptFlowData = conversation.flow_data || {};
          const acceptNegotiationHistory = acceptFlowData.negotiation_history || [];
          acceptNegotiationHistory.push({
            type: 'influencer_accept',
            amount: parseFloat(currentAmount),
            timestamp: new Date().toISOString(),
            message: `Influencer accepted ₹${currentAmount}`
          });

          const acceptUpdatedFlowData = {
            ...acceptFlowData,
            agreed_amount: parseFloat(currentAmount),
            negotiation_history: acceptNegotiationHistory,
            price_agreed: true
          };

          // Update conversation with new flow data
          await supabaseAdmin
            .from('conversations')
            .update({
              flow_data: acceptUpdatedFlowData,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `Perfect! I accept the price of ₹${currentAmount}. Let's proceed with payment.`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Price Accepted',
              subtitle: `Amount: ₹${currentAmount}`,
              buttons: [
                {
                  id: 'proceed_to_payment',
                  text: 'Proceed to Payment',
                  action: 'proceed_to_payment',
                  style: 'primary'
                }
              ]
            }
          };
          break;

        case 'negotiate_price':
          newFlowState = 'brand_owner_pricing';
          newAwaitingRole = 'brand_owner';
          
          // Get the counter offer amount
          const counterAmount = parseFloat(data.price);
          
          // Update conversation flow data with counter offer
          const counterFlowData = conversation.flow_data || {};
          const counterNegotiationHistory = counterFlowData.negotiation_history || [];
          counterNegotiationHistory.push({
            type: 'influencer_counter',
            amount: counterAmount,
            timestamp: new Date().toISOString(),
            message: `Influencer counter-offered ₹${counterAmount}`
          });

          const counterUpdatedFlowData = {
            ...counterFlowData,
            current_amount: counterAmount,
            negotiation_history: counterNegotiationHistory
          };

          // Update conversation with new flow data
          await supabaseAdmin
            .from('conversations')
            .update({
              flow_data: counterUpdatedFlowData,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `I'd like to negotiate the price. How about ₹${counterAmount}?`,
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Price Negotiation',
              subtitle: `Counter offer: ₹${counterAmount}`,
              buttons: [
                {
                  id: 'accept_price',
                  text: 'Accept Counter Offer',
                  action: 'accept_price',
                  style: 'primary'
                },
                {
                  id: 'send_price_offer',
                  text: 'Make New Offer',
                  action: 'send_price_offer',
                  style: 'secondary'
                }
              ]
            }
          };
          break;

        case 'submit_work':
          newFlowState = 'work_submitted';
          newAwaitingRole = 'brand_owner';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: 'I\'ve submitted the work for your review.',
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Work Submitted',
              subtitle: 'Please review the submitted work',
              work_submission: data.workSubmission,
              buttons: [
                {
                  id: 'approve_work',
                  text: 'Approve Work',
                  action: 'approve_work',
                  style: 'primary'
                },
                {
                  id: 'request_revision',
                  text: 'Request Revision',
                  action: 'request_revision',
                  style: 'secondary'
                }
              ]
            }
          };
          break;

        case 'resubmit_work':
          newFlowState = 'work_submitted';
          newAwaitingRole = 'brand_owner';
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: 'I\'ve made the requested changes and resubmitted the work.',
            message_type: 'system',
            is_automated: true,
            action_required: true,
            action_data: {
              title: 'Work Resubmitted',
              subtitle: 'Please review the updated work',
              work_submission: data.workSubmission,
              buttons: [
                {
                  id: 'approve_work',
                  text: 'Approve Work',
                  action: 'approve_work',
                  style: 'primary'
                },
                {
                  id: 'request_revision',
                  text: 'Request Revision',
                  action: 'request_revision',
                  style: 'secondary'
                }
              ]
            }
          };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
        updated_at: new Date().toISOString()
      };

      if (action === 'submit_work' || action === 'resubmit_work') {
        updateData.work_submission = data.workSubmission;
        updateData.work_submitted = true;
        updateData.submission_date = new Date().toISOString();
        updateData.work_status = 'pending';
      }

      const { error: updateError } = await supabaseAdmin
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Create message
      const { data: createdMessage, error: messageError } = await supabaseAdmin
        .from('messages')
        .insert(newMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      return {
        success: true,
        conversation: {
          ...conversation,
          ...updateData
        },
        message: createdMessage
      };
    } catch (error) {
      console.error('Error handling influencer action:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process automated transitions (cron job)
   */
  async processAutomatedTransitions() {
    try {
      const result = await stateMachineService.processAutomatedTransitions();
      return result;
    } catch (error) {
      console.error('Error processing automated transitions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process auto-release for escrow holds (cron job)
   */
  async processAutoRelease() {
    try {
      const result = await escrowService.processAutoRelease();
      return result;
    } catch (error) {
      console.error('Error processing auto-release:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get conversation flow context
   */
  async getConversationFlowContext(conversationId) {
    try {
      const result = await stateMachineService.getConversationFlowContext(conversationId);
      return result;
    } catch (error) {
      console.error('Error getting conversation flow context:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle work submission
   */
  async handleWorkSubmission(conversationId, submissionData) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      // Update conversation state
      const { error: updateError } = await supabaseAdmin
        .from('conversations')
        .update({
          flow_state: 'work_submitted',
          awaiting_role: 'brand_owner',
          work_submission: submissionData,
          work_submitted: true,
          submission_date: new Date().toISOString(),
          work_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Create message
      const { data: message, error: messageError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: conversation.influencer_id,
          receiver_id: conversation.brand_owner_id,
          message: 'I\'ve submitted the work for your review.',
          message_type: 'system',
          is_automated: true,
          action_required: true,
          action_data: {
            title: 'Work Submitted',
            subtitle: 'Please review the submitted work',
            work_submission: submissionData,
            buttons: [
              {
                id: 'approve_work',
                text: 'Approve Work',
                action: 'approve_work',
                style: 'primary'
              },
              {
                id: 'request_revision',
                text: 'Request Revision',
                action: 'request_revision',
                style: 'secondary'
              }
            ]
          }
        })
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      return {
        success: true,
        flow_state: 'work_submitted',
        awaiting_role: 'brand_owner',
        message
      };
    } catch (error) {
      console.error('Error handling work submission:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle work review
   */
  async handleWorkReview(conversationId, action, feedback) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error('Conversation not found');
      }

      let newFlowState, newAwaitingRole, newMessage;

      if (action === 'approve_work') {
        newFlowState = 'work_approved';
        newAwaitingRole = null;
        
        // Release escrow funds
        if (conversation.request_id) {
          const escrowResult = await escrowService.releaseEscrowFunds(
            conversationId,
            'Work approved by brand owner'
          );

          if (!escrowResult.success) {
            console.error('Failed to release escrow funds:', escrowResult.error);
          }
        }

        // Update request status to completed
        if (conversation.request_id) {
          const { error: requestUpdateError } = await supabaseAdmin
            .from('requests')
            .update({
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', conversation.request_id);

          if (requestUpdateError) {
            console.error('Failed to update request status:', requestUpdateError);
          }
        }

        newMessage = {
          conversation_id: conversationId,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          message: 'Excellent work! I approve the submission. Payment has been released.',
          message_type: 'system',
          is_automated: true,
          action_required: false
        };
      } else if (action === 'request_revision') {
        newFlowState = 'work_revision_requested';
        newAwaitingRole = 'influencer';
        
        newMessage = {
          conversation_id: conversationId,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          message: `I'd like some revisions: ${feedback || 'Please make the requested changes.'}`,
          message_type: 'system',
          is_automated: true,
          action_required: true,
          action_data: {
            title: 'Revision Requested',
            subtitle: 'Please make the requested changes',
            buttons: [
              {
                id: 'resubmit_work',
                text: 'Resubmit Work',
                action: 'resubmit_work',
                style: 'primary'
              }
            ]
          }
        };
      } else {
        throw new Error(`Unknown review action: ${action}`);
      }

      // Update conversation state
      const { error: updateError } = await supabaseAdmin
        .from('conversations')
        .update({
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Create message
      const { data: createdMessage, error: messageError } = await supabaseAdmin
        .from('messages')
        .insert(newMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      return {
        success: true,
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
        message: createdMessage
      };
    } catch (error) {
      console.error('Error handling work review:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new AutomatedFlowService();
