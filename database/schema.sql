-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('brand_owner', 'influencer', 'admin');
CREATE TYPE campaign_status AS ENUM ('open', 'pending', 'closed');
CREATE TYPE bid_status AS ENUM ('open', 'pending', 'closed');
CREATE TYPE request_status AS ENUM ('connected', 'negotiating', 'paid', 'completed', 'cancelled');
CREATE TYPE transaction_type AS ENUM ('credit', 'debit');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'failed');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    role user_role DEFAULT 'influencer',
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    languages TEXT[],
    categories TEXT[],
    min_range INTEGER,
    max_range INTEGER,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OTP codes table for WhatsApp authentication
CREATE TABLE otp_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Social platforms table
CREATE TABLE social_platforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform_name TEXT NOT NULL,
    profile_link TEXT,
    followers_count INTEGER,
    engagement_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaigns table (for detailed campaigns)
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL(10,2) NOT NULL,
    status campaign_status DEFAULT 'open',
    start_date DATE,
    end_date DATE,
    requirements TEXT,
    deliverables TEXT[],
    campaign_type campaign_type DEFAULT 'product',
    -- New fields for form
    image_url TEXT,
    language TEXT,
    platform TEXT,
    content_type TEXT,
    -- Package options for product campaigns
    sending_package BOOLEAN DEFAULT FALSE,
    no_of_packages INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bids table (for simple bids)
CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    min_budget DECIMAL(10,2) NOT NULL,
    max_budget DECIMAL(10,2) NOT NULL,
    requirements TEXT,
    language TEXT,
    platform TEXT,
    content_type TEXT,
    category TEXT,
    expiry_date TIMESTAMP WITH TIME ZONE,
    status bid_status DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Requests table (tracks connections for organic discovery and analytics)
CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
    influencer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status request_status DEFAULT 'connected',
    final_agreed_amount DECIMAL(10,2), -- Final price after negotiation
    initial_payment DECIMAL(10,2), -- 30% payment amount
    final_payment DECIMAL(10,2), -- 70% payment amount
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure request is linked to either campaign OR bid, not both
    CONSTRAINT check_source CHECK (
        (campaign_id IS NOT NULL AND bid_id IS NULL) OR 
        (campaign_id IS NULL AND bid_id IS NOT NULL)
    )
);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
    brand_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    influencer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE, -- Re-added for linking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure conversation is linked to either campaign OR bid, not both
    CONSTRAINT check_conversation_source CHECK (
        (campaign_id IS NOT NULL AND bid_id IS NULL) OR 
        (campaign_id IS NULL AND bid_id IS NOT NULL)
    ),
    -- Ensure unique conversation per brand-influencer per campaign/bid
    UNIQUE(campaign_id, brand_owner_id, influencer_id),
    UNIQUE(bid_id, brand_owner_id, influencer_id)
);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    media_url TEXT,
    seen BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wallets table
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Transactions table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    type transaction_type NOT NULL,
    status transaction_status DEFAULT 'pending',
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    payment_stage TEXT, -- 'initial' or 'final'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure transaction is linked to either campaign OR bid, not both
    CONSTRAINT check_transaction_source CHECK (
        (campaign_id IS NOT NULL AND bid_id IS NULL) OR 
        (campaign_id IS NULL AND bid_id IS NOT NULL)
    )
);

-- Create indexes for better performance
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_deleted ON users(is_deleted);
CREATE INDEX idx_otp_codes_phone ON otp_codes(phone);
CREATE INDEX idx_otp_codes_expires ON otp_codes(expires_at);
CREATE INDEX idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_bids_created_by ON bids(created_by);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_requests_campaign_id ON requests(campaign_id);
CREATE INDEX idx_requests_bid_id ON requests(bid_id);
CREATE INDEX idx_requests_influencer_id ON requests(influencer_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_conversations_campaign_id ON conversations(campaign_id);
CREATE INDEX idx_conversations_bid_id ON conversations(bid_id);
CREATE INDEX idx_conversations_brand_owner_id ON conversations(brand_owner_id);
CREATE INDEX idx_conversations_influencer_id ON conversations(influencer_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_campaign_id ON transactions(campaign_id);
CREATE INDEX idx_transactions_bid_id ON transactions(bid_id);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (
        auth.uid()::text = id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (
        auth.uid()::text = id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- RLS Policies for otp_codes table (ADMIN ONLY)
CREATE POLICY "Admin can manage OTP codes" ON otp_codes
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- RLS Policies for social_platforms table
CREATE POLICY "Users can view own social platforms" ON social_platforms
    FOR SELECT USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can manage own social platforms" ON social_platforms
    FOR ALL USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- RLS Policies for campaigns table (RESTRICTIVE)
CREATE POLICY "Users can view campaigns" ON campaigns
    FOR SELECT USING (
        auth.uid()::text = created_by::text OR 
        auth.jwt() ->> 'role' = 'admin' OR
        (auth.jwt() ->> 'role' = 'influencer' AND status = 'open') OR
        EXISTS (
            SELECT 1 FROM requests 
            WHERE campaign_id = campaigns.id 
            AND influencer_id::text = auth.uid()::text
        )
    );
CREATE POLICY "Brand owners can create campaigns" ON campaigns
    FOR INSERT WITH CHECK (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );
CREATE POLICY "Brand owners can update own campaigns" ON campaigns
    FOR UPDATE USING (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );
CREATE POLICY "Brand owners can delete own campaigns" ON campaigns
    FOR DELETE USING (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );

-- RLS Policies for bids table (RESTRICTIVE)
CREATE POLICY "Users can view bids" ON bids
    FOR SELECT USING (
        auth.uid()::text = created_by::text OR 
        auth.jwt() ->> 'role' = 'admin' OR
        (auth.jwt() ->> 'role' = 'influencer' AND status = 'open') OR
        EXISTS (
            SELECT 1 FROM requests 
            WHERE bid_id = bids.id 
            AND influencer_id::text = auth.uid()::text
        )
    );
CREATE POLICY "Brand owners can create bids" ON bids
    FOR INSERT WITH CHECK (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );
CREATE POLICY "Brand owners can update own bids" ON bids
    FOR UPDATE USING (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );
CREATE POLICY "Brand owners can delete own bids" ON bids
    FOR DELETE USING (
        auth.uid()::text = created_by::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );

-- RLS Policies for requests table
CREATE POLICY "Users can view relevant requests" ON requests
    FOR SELECT USING (
        auth.uid()::text = influencer_id::text OR
        auth.jwt() ->> 'role' = 'admin' OR
        EXISTS (
            SELECT 1 FROM campaigns 
            WHERE id = requests.campaign_id 
            AND created_by::text = auth.uid()::text
        ) OR
        EXISTS (
            SELECT 1 FROM bids 
            WHERE id = requests.bid_id 
            AND created_by::text = auth.uid()::text
        )
    );
CREATE POLICY "Influencers can create requests" ON requests
    FOR INSERT WITH CHECK (
        auth.uid()::text = influencer_id::text AND 
        auth.jwt() ->> 'role' = 'influencer'
    );
CREATE POLICY "Users can update relevant requests" ON requests
    FOR UPDATE USING (
        auth.uid()::text = influencer_id::text OR
        auth.jwt() ->> 'role' = 'admin' OR
        EXISTS (
            SELECT 1 FROM campaigns 
            WHERE id = requests.campaign_id 
            AND created_by::text = auth.uid()::text
        ) OR
        EXISTS (
            SELECT 1 FROM bids 
            WHERE id = requests.bid_id 
            AND created_by::text = auth.uid()::text
        )
    );

-- RLS Policies for conversations table (AUTHENTICATED USERS ONLY)
CREATE POLICY "Authenticated users can view relevant conversations" ON conversations
    FOR SELECT USING (
        auth.uid()::text = brand_owner_id::text OR
        auth.uid()::text = influencer_id::text OR
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Authenticated users can create conversations" ON conversations
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND
        (auth.uid()::text = brand_owner_id::text OR auth.uid()::text = influencer_id::text)
    );

-- RLS Policies for messages table (AUTHENTICATED USERS ONLY)
CREATE POLICY "Authenticated users can view relevant messages" ON messages
    FOR SELECT USING (
        auth.uid()::text = sender_id::text OR
        auth.uid()::text = receiver_id::text OR
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Authenticated users can create messages" ON messages
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND
        auth.uid()::text = sender_id::text
    );
CREATE POLICY "Authenticated users can update own messages" ON messages
    FOR UPDATE USING (
        auth.uid()::text = sender_id::text OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- RLS Policies for wallets table
CREATE POLICY "Users can view own wallet" ON wallets
    FOR SELECT USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can update own wallet" ON wallets
    FOR UPDATE USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- RLS Policies for transactions table
CREATE POLICY "Users can view own transactions" ON transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM wallets 
            WHERE wallets.id = transactions.wallet_id 
            AND wallets.user_id::text = auth.uid()::text
        ) OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can create own transactions" ON transactions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM wallets 
            WHERE wallets.id = transactions.wallet_id 
            AND wallets.user_id::text = auth.uid()::text
        ) OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- Create function to automatically create wallet for new users
CREATE OR REPLACE FUNCTION create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO wallets (user_id, balance)
    VALUES (NEW.id, 0.00);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to create wallet on user insert
CREATE TRIGGER create_wallet_for_user
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_wallet_for_user();

-- Create function to create conversation when request is approved
CREATE OR REPLACE FUNCTION create_conversation_for_approved_request()
RETURNS TRIGGER AS $$
DECLARE
    source_id UUID;
    source_type TEXT;
    brand_owner_id UUID;
BEGIN
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        IF NEW.campaign_id IS NOT NULL THEN
            source_id := NEW.campaign_id;
            source_type := 'campaign';
            SELECT created_by INTO brand_owner_id FROM campaigns WHERE id = NEW.campaign_id;
        ELSE
            source_id := NEW.bid_id;
            source_type := 'bid';
            SELECT created_by INTO brand_owner_id FROM bids WHERE id = NEW.bid_id;
        END IF;
        
        INSERT INTO conversations (
            campaign_id, 
            bid_id, 
            brand_owner_id, 
            influencer_id,
            request_id -- Re-added for linking
        ) VALUES (
            CASE WHEN source_type = 'campaign' THEN source_id ELSE NULL END,
            CASE WHEN source_type = 'bid' THEN source_id ELSE NULL END,
            brand_owner_id,
            NEW.influencer_id,
            NEW.id -- Link to the request
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to create conversation on request status change
CREATE TRIGGER create_conversation_for_approved_request
    AFTER UPDATE ON requests
    FOR EACH ROW
    EXECUTE FUNCTION create_conversation_for_approved_request();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_otp_codes_updated_at BEFORE UPDATE ON otp_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_social_platforms_updated_at BEFORE UPDATE ON social_platforms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bids_updated_at BEFORE UPDATE ON bids
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requests_updated_at BEFORE UPDATE ON requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 