import { Handler } from '@netlify/functions'

const OPENAPI_SDI_TOKEN = '69567f51a9928bf1e0083a74'
const OPENAPI_SDI_BASE_URL = 'https://sdi.openapi.it'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        // Step 1: Create API Configuration for the company
        console.log('[API Config] Creating API configuration for fiscal_id: 04104640927')

        const apiConfigData = {
            fiscal_id: '04104640927'
        }

        const configResponse = await fetch(`${OPENAPI_SDI_BASE_URL}/api_configurations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAPI_SDI_TOKEN}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(apiConfigData)
        })

        const configResponseData = await configResponse.json()

        console.log('[API Config] Response:', configResponseData)

        if (!configResponse.ok) {
            return {
                statusCode: configResponse.status,
                body: JSON.stringify({
                    error: 'Failed to create API configuration',
                    details: configResponseData,
                    status: configResponse.status
                })
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'API Configuration created successfully',
                data: configResponseData
            })
        }
    } catch (error: any) {
        console.error('[API Config] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}
