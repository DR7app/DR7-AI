-- Signature Requests table
CREATE TABLE IF NOT EXISTS signature_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    signer_name VARCHAR(255) NOT NULL,
    signer_email VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'otp_sent', 'otp_verified', 'signed', 'expired', 'cancelled')),
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMPTZ,
    otp_attempts INT DEFAULT 0,
    token_expires_at TIMESTAMPTZ NOT NULL,
    original_pdf_hash VARCHAR(64),
    signed_pdf_url TEXT,
    signed_pdf_hash VARCHAR(64),
    signer_ip VARCHAR(45),
    signer_user_agent TEXT,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signature Audit Trail table
CREATE TABLE IF NOT EXISTS signature_audit_trail (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    signature_request_id UUID REFERENCES signature_requests(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_description TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON signature_requests(token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_contract ON signature_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON signature_requests(status);
CREATE INDEX IF NOT EXISTS idx_signature_audit_request ON signature_audit_trail(signature_request_id);
CREATE INDEX IF NOT EXISTS idx_signature_audit_created ON signature_audit_trail(created_at);

-- RLS policies
ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_audit_trail ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access on signature_requests"
    ON signature_requests FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on signature_audit_trail"
    ON signature_audit_trail FOR ALL
    USING (true) WITH CHECK (true);
