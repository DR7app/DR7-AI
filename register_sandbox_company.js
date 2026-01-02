#!/usr/bin/env node

/**
 * Register company in OpenAPI.it Sandbox - Alternative approach
 * Try registering directly via business_registry_configurations
 */

const SANDBOX_TOKEN = '69567f51a9928bf1e0083a74'
const SANDBOX_BASE_URL = 'https://test.sdi.openapi.it'

// Your company details - matching what you entered in the web form
const COMPANY_DATA = {
    fiscal_id: '04104640927',
    business_name: 'DUBAI RENT 7.0 S.P.A.',
    pec_destinatario: 'SUBM70N',
    email: 'info@dr7.app',
    phone: '3472817258',
    apply_legal_storage: false, // Set to false for sandbox testing
    apply_signature: false, // Set to false for sandbox testing
    address: {
        street: 'VIA DEL FANGARIO 25',
        zip_code: '09122',
        city: 'Cagliari',
        province: 'CA',
        country: 'IT'
    }
}

async function registerCompanyDirect() {
    console.log('🚀 Registering company in OpenAPI Sandbox (Direct Method)...\n')
    console.log('Company:', COMPANY_DATA.business_name)
    console.log('VAT:', COMPANY_DATA.fiscal_id)
    console.log('PEC/SDI:', COMPANY_DATA.pec_destinatario, '\n')

    try {
        // Try direct business registry registration
        console.log('📝 Creating Business Registry Configuration...')
        const response = await fetch(`${SANDBOX_BASE_URL}/business_registry_configurations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SANDBOX_TOKEN}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(COMPANY_DATA)
        })

        const data = await response.json()

        console.log('\n📋 Response Status:', response.status)
        console.log('📋 Response Data:', JSON.stringify(data, null, 2))

        if (response.ok) {
            console.log('\n✅ SUCCESS! Company registered in sandbox')
            console.log('\nYou can now:')
            console.log('1. Generate invoices from your admin panel')
            console.log('2. They will be sent to the sandbox SDI')
            console.log('3. Check status at: https://test.sdi.openapi.it\n')
        } else {
            console.log('\n⚠️  Registration response:', data)

            if (data.message?.includes('already exists') || data.message?.includes('già esiste')) {
                console.log('\n✅ Company already registered! You\'re good to go.')
            } else {
                console.log('\n❌ Registration failed. You may need to:')
                console.log('1. Register your fiscal ID manually at: https://console.openapi.com')
                console.log('2. Or contact OpenAPI.it support for sandbox access')
            }
        }

    } catch (error) {
        console.error('\n💥 Error:', error.message)
        console.error('Full error:', error)
    }
}

// Run
registerCompanyDirect()
