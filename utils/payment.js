const crypto = require('crypto');
const { supabaseAdmin } = require('../supabase/client');

class PaymentService {
    /**
     * Verify payment signature from frontend
     */
    verifyPaymentSignature(orderId, paymentId, signature, secret) {
        const text = `${orderId}|${paymentId}`;
        const generatedSignature = crypto
            .createHmac('sha256', secret)
            .update(text)
            .digest('hex');

        return generatedSignature === signature;
    }

    /**
     * Process payment response from frontend
     */
    async processPaymentResponse(paymentData) {
        try {
            const { 
                razorpay_order_id, 
                razorpay_payment_id, 
                razorpay_signature,
                request_id,
                amount,
                payment_stage // 'initial' (30%) or 'final' (70%)
            } = paymentData;

            // Get request details
            const { data: request, error: requestError } = await supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    bids (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `)
                .eq('id', request_id)
                .single();

            if (requestError || !request) {
                throw new Error('Request not found');
            }

            // Determine the source type and ID
            const sourceType = request.campaign_id ? 'campaign' : 'bid';
            const sourceId = request.campaign_id || request.bid_id;
            const source = request.campaigns || request.bids;

            // Create transaction record
            const transactionData = {
                wallet_id: request.influencer.wallets.id,
                amount: amount,
                type: 'credit',
                status: 'completed',
                request_id: request_id,
                razorpay_order_id: razorpay_order_id,
                razorpay_payment_id: razorpay_payment_id,
                payment_stage: payment_type
            };

            if (sourceType === 'campaign') {
                transactionData.campaign_id = sourceId;
            } else {
                transactionData.bid_id = sourceId;
            }

            const { data: transaction, error: transactionError } = await supabaseAdmin
                .from('transactions')
                .insert(transactionData)
                .select()
                .single();

            if (transactionError) {
                throw new Error('Failed to create transaction record');
            }

            // Update wallet balance
            const newBalance = parseFloat(request.influencer.wallets.balance) + parseFloat(amount);
            await supabaseAdmin
                .from('wallets')
                .update({ balance: newBalance })
                .eq('id', request.influencer.wallets.id);

            // Update request status based on payment stage
            if (payment_stage === 'initial') {
                // 30% payment - start work
                await supabaseAdmin
                    .from('requests')
                    .update({ 
                        status: 'paid',
                        initial_payment: amount
                    })
                    .eq('id', request_id);

                // Update source status to pending (work in progress)
                if (sourceType === 'campaign') {
                    await supabaseAdmin
                        .from('campaigns')
                        .update({ status: 'pending' })
                        .eq('id', sourceId);
                } else {
                    await supabaseAdmin
                        .from('bids')
                        .update({ status: 'pending' })
                        .eq('id', sourceId);
                }
            } else if (payment_stage === 'final') {
                // 70% payment - complete work
                await supabaseAdmin
                    .from('requests')
                    .update({ 
                        status: 'completed',
                        final_payment: amount
                    })
                    .eq('id', request_id);

                // Update source status to closed
                if (sourceType === 'campaign') {
                    await supabaseAdmin
                        .from('campaigns')
                        .update({ status: 'closed' })
                        .eq('id', sourceId);
                } else {
                    await supabaseAdmin
                        .from('bids')
                        .update({ status: 'closed' })
                        .eq('id', sourceId);
                }
            }

            return {
                success: true,
                transaction: transaction,
                message: 'Payment processed successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get transaction history for a user
     */
    async getTransactionHistory(userId, page = 1, limit = 10, status = null) {
        try {
            const offset = (page - 1) * limit;

            let query = supabaseAdmin
                .from('transactions')
                .select(`
                    *,
                    wallets!inner (
                        user_id
                    ),
                    campaigns (
                        id,
                        title,
                        type:campaign_type
                    )
                `, { count: 'exact' })
                .eq('wallets.user_id', userId);

            if (status) {
                query = query.eq('status', status);
            }

            const { data: transactions, error, count } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) {
                throw new Error('Failed to fetch transactions');
            }

            return {
                success: true,
                transactions: transactions,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limit)
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get wallet balance
     */
    async getWalletBalance(userId) {
        try {
            const { data: wallet, error } = await supabaseAdmin
                .from('wallets')
                .select('balance')
                .eq('user_id', userId)
                .single();

            if (error || !wallet) {
                throw new Error('Wallet not found');
            }

            return {
                success: true,
                balance: wallet.balance
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get payment statistics
     */
    async getPaymentStats(userId) {
        try {
            const { data: transactions, error } = await supabaseAdmin
                .from('transactions')
                .select(`
                    amount,
                    type,
                    status,
                    wallets!inner (
                        user_id
                    )
                `)
                .eq('wallets.user_id', userId);

            if (error) {
                throw new Error('Failed to fetch payment statistics');
            }

            const stats = {
                totalEarnings: 0,
                totalSpent: 0,
                completedTransactions: 0,
                pendingTransactions: 0,
                failedTransactions: 0
            };

            transactions.forEach(transaction => {
                const amount = parseFloat(transaction.amount);

                if (transaction.type === 'credit') {
                    stats.totalEarnings += amount;
                } else if (transaction.type === 'debit') {
                    stats.totalSpent += amount;
                }

                switch (transaction.status) {
                    case 'completed':
                        stats.completedTransactions++;
                        break;
                    case 'pending':
                        stats.pendingTransactions++;
                        break;
                    case 'failed':
                        stats.failedTransactions++;
                        break;
                }
            });

            return {
                success: true,
                stats: stats
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Create a refund record
     */
    async createRefundRecord(paymentId, amount, reason) {
        try {
            // Update original transaction status
            const { error: updateError } = await supabaseAdmin
                .from('transactions')
                .update({ status: 'refunded' })
                .eq('razorpay_payment_id', paymentId);

            if (updateError) {
                throw new Error('Failed to update transaction status');
            }

            // Create refund transaction record
            const { data: refundTransaction, error: refundError } = await supabaseAdmin
                .from('transactions')
                .insert({
                    amount: amount,
                    type: 'debit',
                    status: 'completed',
                    razorpay_payment_id: paymentId,
                    notes: `Refund: ${reason}`
                })
                .select()
                .single();

            if (refundError) {
                throw new Error('Failed to create refund record');
            }

            return {
                success: true,
                refund: refundTransaction,
                message: 'Refund processed successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new PaymentService(); 